import concurrent.futures, datetime, hashlib, html.parser, json, pathlib, urllib.request, sys
REFRESH='--refresh' in sys.argv
ROOT=pathlib.Path(__file__).resolve().parent.parent
CACHE=ROOT/'knowledge'/'source-cache'; CACHE.mkdir(exist_ok=True)
class Text(html.parser.HTMLParser):
 def __init__(self): super().__init__(); self.hidden=0; self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'): self.hidden+=1
 def handle_endtag(self,tag):
  if tag in ('script','style'): self.hidden=max(0,self.hidden-1)
 def handle_data(self,data):
  if not self.hidden and data.strip(): self.parts.append(data.strip())
def fetch(item):
 key,url=item
 existing=ROOT/'knowledge/source-verification.json'
 if not REFRESH and existing.exists() and (CACHE/(key+'.txt')).exists():
  old=json.loads(existing.read_text(encoding='utf8')).get(key,{})
  if old.get('url')==url and old.get('status')==200:return key,old
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'LiveDeskAI-reference-audit/1.0'})
  with urllib.request.urlopen(req,timeout=25) as res:
   raw=res.read(8_000_000); final=res.url; status=res.status
  parser=Text();parser.feed(raw.decode('utf8',errors='replace'));text='\n'.join(parser.parts)
  (CACHE/(key+'.txt')).write_text(text,encoding='utf8')
  return key,{'url':url,'resolvedUrl':final,'status':status,'characters':len(text),'sha256':hashlib.sha256(raw).hexdigest(),'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 except Exception as e:return key,{'url':url,'error':str(e)}
if __name__=='__main__':
 sources=json.loads((ROOT/'knowledge/sources.json').read_text())
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=dict(pool.map(fetch,sources.items()))
 (ROOT/'knowledge/source-verification.json').write_text(json.dumps(results,indent=2),encoding='utf8')
 for key,result in results.items(): print(key, result.get('status',result.get('error')),result.get('characters',''))
