"""Local, memory-only OCR worker. stdout is a private JSON pipe, never a log file."""
import sys,json,base64,time,argparse,unicodedata,hashlib
from collections import OrderedDict
import cv2,numpy as np
from rapidocr_onnxruntime import RapidOCR
p=argparse.ArgumentParser();p.add_argument('--model',required=True);a=p.parse_args()
sys.stdout.reconfigure(encoding='utf-8');sys.stdin.reconfigure(encoding='utf-8')
engine=RapidOCR(rec_model_path=a.model,intra_op_num_threads=4,inter_op_num_threads=2)
def line_regions(img):
 if cv2.meanStdDev(img)[1].max()==0:return []
 bg=np.median(np.concatenate([img[0],img[-1],img[:,0],img[:,-1]]),axis=0)
 mask=np.max(np.abs(img.astype(np.int16)-bg),axis=2)>60
 coverage=mask.sum(axis=1); ys=np.where((coverage>1)&(coverage<img.shape[1]*.65))[0]
 if np.mean(coverage>=img.shape[1]*.65)>.08:return None
 groups=[]
 for y in ys:
  if not groups or y>groups[-1][-1]+2:groups.append([])
  groups[-1].append(y)
 regions=[]
 for g in groups:
  y1,y2=int(g[0]),int(g[-1]+1)
  if y2-y1<4 or y2-y1>100:continue
  xs=np.where(mask[y1:y2].any(axis=0))[0]
  if len(xs):regions.append((max(0,int(xs[0])-5),max(0,y1-6),min(img.shape[1],int(xs[-1])+6),min(img.shape[0],y2+6)))
 return regions or None
cache=OrderedDict()
print(json.dumps({'ready':True}),flush=True)
for raw in sys.stdin:
 req={}
 try:
  req=json.loads(raw);start=time.perf_counter();data=base64.b64decode(req['image'].split(',')[-1]);img=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
  if img is None:raise ValueError('invalid image')
  regions=line_regions(img);prep=(time.perf_counter()-start)*1000;lines=[];cache_hits=0;ocr_start=time.perf_counter()
  if regions is not None:
   for x1,y1,x2,y2 in regions:
    crop=img[y1:y2,x1:x2];key=hashlib.sha256(crop.tobytes()+str(crop.shape).encode()).digest()
    if key in cache:
     found=cache[key];cache.move_to_end(key);cache_hits+=1
    else:
     found,_=engine(crop,use_det=False,use_cls=False,use_rec=True);cache[key]=found
     if len(cache)>256:cache.popitem(last=False)
    for text,score in found or []:
     lines.append({'text':text,'x':x1,'y':y1,'width':x2-x1,'height':y2-y1,'confidence':float(score)})
  else:
   found,_=engine(img,use_cls=False)
   for box,text,score in found or []:
    lines.append({'text':text,'x':float(box[0][0]),'y':float(box[0][1]),'width':float(box[2][0]-box[0][0]),'height':float(box[2][1]-box[0][1]),'confidence':float(score)})
  print(json.dumps({'id':req['id'],'ok':True,'text':'\n'.join(l['text'] for l in lines),'lines':lines,'backend':'Local OCR','blank':regions is not None and len(regions)==0,'preprocessingMs':prep,'ocrMs':(time.perf_counter()-ocr_start)*1000,'regionCacheHits':cache_hits}),flush=True)
 except Exception:
  print(json.dumps({'id':req.get('id'),'ok':False,'category':'VISION_OCR_FAILURE'}),flush=True)
