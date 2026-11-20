import json, os, queue, threading, time, urllib.request, urllib.error, tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

HERE=os.path.dirname(os.path.abspath(__file__)); CFG=os.path.join(HERE,'settings.json')
DEFAULT={'transcription_model':'base','provider':'Ollama','base_url':'http://localhost:11434','chat_model':'qwen2.5:7b','api_key':'','auto_draft':True}
def load_cfg():
 try:
  with open(CFG,encoding='utf-8') as f: return {**DEFAULT,**json.load(f)}
 except Exception: return DEFAULT.copy()
def save_cfg(c):
 with open(CFG,'w',encoding='utf-8') as f: json.dump(c,f,indent=2)

class App:
 def __init__(self,root):
  self.root=root; root.title('LiveDesk AI'); root.geometry('1000x740'); root.minsize(800,580)
  self.cfg=load_cfg(); self.q=queue.Queue(); self.uiq=queue.Queue(); self.stop_event=threading.Event(); self.running=False; self.threads=[]; self.model=None; self.transcript_text=''; self.timer=None
  self.build(); root.after(100,self.poll); root.protocol('WM_DELETE_WINDOW',self.close)
 def build(self):
  f=ttk.Frame(self.root,padding=12); f.pack(fill='both',expand=True)
  head=ttk.Frame(f); head.pack(fill='x'); ttk.Label(head,text='LiveDesk AI',font=('Segoe UI',20,'bold')).pack(side='left')
  self.status=tk.StringVar(value='Ready'); ttk.Label(head,textvariable=self.status).pack(side='right')
  ttk.Label(f,text='Live PC-audio/microphone transcription with AI-drafted answers. Use only where recording and AI assistance are permitted. This app remains a normal visible window.',wraplength=950).pack(fill='x',pady=8)
  box=ttk.LabelFrame(f,text='Settings',padding=8); box.pack(fill='x')
  r=ttk.Frame(box); r.pack(fill='x',pady=3)
  ttk.Label(r,text='Whisper').pack(side='left'); self.whisper=tk.StringVar(value=self.cfg['transcription_model']); ttk.Combobox(r,textvariable=self.whisper,values=['tiny','base','small','medium'],width=9,state='readonly').pack(side='left',padx=5)
  ttk.Label(r,text='Provider').pack(side='left',padx=(10,0)); self.provider=tk.StringVar(value=self.cfg['provider']); ttk.Combobox(r,textvariable=self.provider,values=['Ollama','OpenAI-compatible'],width=18,state='readonly').pack(side='left',padx=5)
  ttk.Label(r,text='Model').pack(side='left'); self.modelname=tk.StringVar(value=self.cfg['chat_model']); ttk.Entry(r,textvariable=self.modelname,width=20).pack(side='left',padx=5)
  self.auto=tk.BooleanVar(value=self.cfg['auto_draft']); ttk.Checkbutton(r,text='Auto-draft',variable=self.auto).pack(side='right')
  r=ttk.Frame(box); r.pack(fill='x',pady=3); ttk.Label(r,text='Base URL').pack(side='left'); self.url=tk.StringVar(value=self.cfg['base_url']); ttk.Entry(r,textvariable=self.url,width=43).pack(side='left',padx=5)
  ttk.Label(r,text='API key').pack(side='left',padx=(8,0)); self.key=tk.StringVar(value=self.cfg['api_key']); ttk.Entry(r,textvariable=self.key,width=24,show='•').pack(side='left',padx=5); ttk.Button(r,text='Save',command=self.save).pack(side='right')
  r=ttk.Frame(f); r.pack(fill='x',pady=10); self.startbtn=ttk.Button(r,text='Start listening',command=self.start); self.startbtn.pack(side='left'); self.stopbtn=ttk.Button(r,text='Stop',command=self.stop,state='disabled'); self.stopbtn.pack(side='left',padx=5)
  ttk.Button(r,text='Generate answer now',command=self.answer_now).pack(side='left',padx=5); ttk.Button(r,text='Clear',command=self.clear).pack(side='left',padx=5)
  pan=ttk.Panedwindow(f,orient='vertical'); pan.pack(fill='both',expand=True)
  a=ttk.LabelFrame(pan,text='Live transcript',padding=5); b=ttk.LabelFrame(pan,text='AI draft answer',padding=5); pan.add(a,weight=3); pan.add(b,weight=2)
  self.transcript=scrolledtext.ScrolledText(a,wrap='word',font=('Segoe UI',10)); self.transcript.pack(fill='both',expand=True)
  self.answer=scrolledtext.ScrolledText(b,wrap='word',font=('Segoe UI',11)); self.answer.pack(fill='both',expand=True)
  ttk.Button(f,text='Copy answer',command=self.copy).pack(anchor='e',pady=(8,0))
 def save(self):
  self.cfg.update(transcription_model=self.whisper.get(),provider=self.provider.get(),base_url=self.url.get().strip().rstrip('/'),chat_model=self.modelname.get().strip(),api_key=self.key.get(),auto_draft=self.auto.get()); save_cfg(self.cfg); self.status.set('Settings saved')
 def start(self):
  if self.running:return
  self.save(); self.stop_event.clear(); self.running=True; self.startbtn.config(state='disabled'); self.stopbtn.config(state='normal'); self.status.set('Loading models…'); threading.Thread(target=self.setup,daemon=True).start()
 def setup(self):
  try:
   from faster_whisper import WhisperModel
   try: self.model=WhisperModel(self.cfg['transcription_model'],device='cuda',compute_type='float16')
   except Exception: self.model=WhisperModel(self.cfg['transcription_model'],device='cpu',compute_type='int8')
   import soundcard as sc
   loops=[m for m in sc.all_microphones(include_loopback=True) if getattr(m,'isloopback',False)]
   mics=list(sc.all_microphones(include_loopback=False))
   if not loops and not mics: raise RuntimeError('No usable audio devices found. Check Windows audio settings.')
   if loops:self.threads.append(threading.Thread(target=self.capture,args=(loops[0],'PC audio'),daemon=True))
   if mics:
    try: mic=sc.default_microphone()
    except Exception: mic=mics[0]
    self.threads.append(threading.Thread(target=self.capture,args=(mic,'Microphone'),daemon=True))
   for t in self.threads:t.start()
   threading.Thread(target=self.transcribe,daemon=True).start(); self.uiq.put(('status','Listening'))
  except Exception as e:
   self.uiq.put(('error',f'Could not start: {e}\n\nRun install.bat, then restart.')); self.uiq.put(('failed',None))
 def capture(self,device,label):
  import soundcard as sc
  rate=16000
  while not self.stop_event.is_set():
   try:
    with device.recorder(samplerate=rate,channels=1) as rec: audio=rec.record(numframes=rate*5)
    if audio is not None and len(audio):self.q.put((label,audio))
   except Exception as e:
    self.uiq.put(('status',f'{label} capture retrying')); time.sleep(1)
 def transcribe(self):
  import numpy as np
  while not self.stop_event.is_set() or not self.q.empty():
   try: source,audio=self.q.get(timeout=.3)
   except queue.Empty:continue
   try:
    samples=np.asarray(audio,dtype=np.float32); samples=samples.mean(axis=1) if samples.ndim>1 else samples
    if samples.size and float(np.max(np.abs(samples)))>.008:
     segs,_=self.model.transcribe(np.clip(samples,-1,1),language='en',vad_filter=True,beam_size=1); text=' '.join(s.text.strip() for s in segs).strip()
     if text:
      line=f'[{time.strftime("%H:%M:%S")}] {source}: {text}\n'; self.transcript_text=(self.transcript_text+'\n'+source+': '+text)[-10000:]; self.uiq.put(('transcript',line))
      if self.auto.get():
       self.uiq.put(('debounce',None))
   except Exception as e:self.uiq.put(('status',f'Transcription error: {e}'))
   finally:self.q.task_done()
 def stop(self):
  if not self.running:return
  self.stop_event.set(); self.running=False; self.startbtn.config(state='normal'); self.stopbtn.config(state='disabled'); self.status.set('Stopped')
  if self.timer:
   try:self.root.after_cancel(self.timer)
   except Exception:pass
   self.timer=None
 def answer_now(self):
  text=self.transcript_text.strip()
  if not text:self.status.set('Waiting for transcript'); return
  self.save(); self.status.set('Generating answer…'); threading.Thread(target=self.call_ai,args=(text,),daemon=True).start()
 def call_ai(self,text):
  try:
   provider=self.cfg['provider']; model=self.cfg['chat_model']; system='You are a helpful conversation assistant. Based on this recent transcript, identify the latest question and draft a concise, accurate, conversational answer. If unclear, state what needs clarification. Do not invent facts.'
   user='Recent transcript, newest at end:\n'+text[-7000:]+'\n\nDraft an answer to the latest question.'
   if provider=='Ollama':url=self.cfg['base_url']+'/api/chat'; data={'model':model,'stream':False,'messages':[{'role':'system','content':system},{'role':'user','content':user}]}; headers={'Content-Type':'application/json'}
   else:
    url=self.cfg['base_url']+'/v1/chat/completions'; data={'model':model,'stream':False,'messages':[{'role':'system','content':system},{'role':'user','content':user}],'temperature':.4}; headers={'Content-Type':'application/json'}
    if self.cfg['api_key'].strip():headers['Authorization']='Bearer '+self.cfg['api_key'].strip()
   req=urllib.request.Request(url,data=json.dumps(data).encode(),headers=headers,method='POST')
   with urllib.request.urlopen(req,timeout=90) as res:out=json.loads(res.read().decode())
   answer=out.get('message',{}).get('content','') if provider=='Ollama' else out.get('choices',[{}])[0].get('message',{}).get('content','')
   if not answer:raise RuntimeError('Provider returned an empty answer')
   self.uiq.put(('answer',answer.strip())); self.uiq.put(('status','Answer ready'))
  except Exception as e:self.uiq.put(('error',f'AI request failed: {e}')); self.uiq.put(('status','AI request failed'))
 def poll(self):
  try:
   while True:
    kind,val=self.uiq.get_nowait()
    if kind=='status':self.status.set(val)
    elif kind=='transcript':self.transcript.insert('end',val); self.transcript.see('end')
    elif kind=='answer':self.answer.delete('1.0','end'); self.answer.insert('end',val)
    elif kind=='error':messagebox.showerror('LiveDesk AI',val)
    elif kind=='failed':self.running=False; self.startbtn.config(state='normal'); self.stopbtn.config(state='disabled')
    elif kind=='debounce':
     if self.timer:
      try:self.root.after_cancel(self.timer)
      except Exception:pass
     self.timer=self.root.after(1800,self.answer_now)
  except queue.Empty:pass
  self.root.after(100,self.poll)
 def copy(self):
  text=self.answer.get('1.0','end').strip()
  if text:self.root.clipboard_clear(); self.root.clipboard_append(text); self.status.set('Copied')
 def clear(self):self.transcript_text=''; self.transcript.delete('1.0','end'); self.answer.delete('1.0','end')
 def close(self):self.stop_event.set(); self.root.destroy()

if __name__=='__main__':
 root=tk.Tk()
 try:ttk.Style().theme_use('vista')
 except Exception:pass
 App(root); root.mainloop()
