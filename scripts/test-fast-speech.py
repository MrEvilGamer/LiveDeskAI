import sys, re, json, urllib.request
audio=open(sys.argv[1],'rb').read()
boundary='--livedesk-quality'
body=b''
for key,value in [('model','base'),('language','en'),('hotwords','Python, JavaScript, Rust, SQL, deterministic replay, thread scheduling')]:
    body+=('--'+boundary+'\r\nContent-Disposition: form-data; name="'+key+'"\r\n\r\n'+value+'\r\n').encode()
body+=('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="fast.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode()+audio+b'\r\n'+('--'+boundary+'--\r\n').encode()
req=urllib.request.Request('http://127.0.0.1:8399/v1/audio/transcriptions',data=body,headers={'Content-Type':'multipart/form-data; boundary='+boundary})
result=json.loads(urllib.request.urlopen(req,timeout=60).read())
expected='I use Python JavaScript Rust and SQL to build backend services Could you explain how deterministic replay handles thread scheduling'.lower().split()
actual=re.findall(r'\w+',result['text'].lower())
row=list(range(len(actual)+1))
for i,word in enumerate(expected,1):
    new=[i]
    for j,heard in enumerate(actual,1): new.append(min(new[-1]+1,row[j]+1,row[j-1]+(word!=heard)))
    row=new
print(json.dumps({'text':result['text'],'wordErrors':row[-1],'words':len(expected),'decodeMs':result.get('ms')}))
