import json,pathlib,re,hashlib,datetime
ROOT=pathlib.Path(__file__).resolve().parent.parent
sources=json.loads((ROOT/'knowledge/sources.json').read_text())
verification=json.loads((ROOT/'knowledge/source-verification.json').read_text())
remap={'hash-table':['algorithms-hash'],'lru':['algorithms-list'],'heap':['algo-heap'],'bfs-dfs':['algorithms-traversal'],'dijkstra':['algo-dijkstra'],'amortized':['algorithms-1-detail0'],'complexity-output':['algorithms-0'],'result-option':['rust-option','rust-errors']}
cards=[];cases=[];missing=[]
for file in sorted((ROOT/'knowledge/seeds').glob('*.tsv')):
 for index,row in enumerate(file.read_text(encoding='utf-8-sig').splitlines()):
  if not row.strip():continue
  slug,question,fact,criteria,mistake,scenario,applied,refs,needle=row.split('|')
  refs=remap.get(slug,refs.split(','));cardid=file.stem+'.'+slug
  excerpts=[]
  for source in refs:
   cache=ROOT/'knowledge/source-cache'/(source+'.txt')
   text=cache.read_text(encoding='utf8') if cache.exists() else ''
   at=text.lower().find(needle.lower())
   if at>=0:excerpts.append({'source':source,'needle':needle,'excerpt':text[max(0,at-100):at+500]})
  if not excerpts:missing.append(cardid)
  groups=[g.split('~') for g in criteria.split(';')]
  card={'id':cardid,'domain':file.stem,'title':slug.replace('-',' '),'question':question,'fact':fact,'criteria':groups,'commonMistakes':[mistake],'sources':refs,'sourceEvidence':excerpts,'versionNote':'State the runtime/protocol/database version before version-dependent claims.' if file.stem in ('node','git','algorithms') else ''}
  cards.append(card)
  for kind,q,answer in [('concept',question,fact),('scenario',scenario,fact+' '+applied)]:
   adversarial=kind=='scenario' and index%4==0
   if adversarial:q+=' A proposed explanation says: "'+mistake+'" Is that assumption valid?'
   ctype='factual' if kind=='concept' else ('architecture' if file.stem=='distributed' else 'security-review' if file.stem=='security' else 'test-design' if file.stem=='testing' else 'sql' if slug.startswith('sql-') else 'debugging')
   selected=groups if kind=='concept' else [g for g in groups if any(t.lower() in applied.lower() for t in g)]
   if len(selected)<2:selected=groups[:2]
   cases.append({'id':cardid+'.'+kind,'domain':file.stem,'cardId':cardid,'type':ctype,'question':q,'referenceAnswer':answer,'criteria':selected,'commonMistakes':[mistake],'sources':refs,'adversarial':adversarial,'context':[],'verification':{'method':'Authored reference grounded in linked primary documentation; source excerpt lookup is not semantic proof.','sourceEvidenceLocated':bool(excerpts),'independentExpertReview':'pending'}})
assert len(cards)==105 and len(cases)==210
assert len({c['question'] for c in cases})==210
# Explicit follow-ups have supplied, source-backed prior context, identical across both pipelines.
for case in cases:
 if case['id'].endswith('.scenario') and case['cardId'] in ('rust.rc-arc','node.backpressure','security.refresh-rotation','distributed.cache','git.always-cancel','testing.scheduler','algorithms.pagination'):
  card=next(c for c in cards if c['id']==case['cardId']);case['type']='follow-up';case['context']=[{'question':card['question'],'answer':card['fact']}]
  case['question']='Follow-up on the preceding explanation: '+case['question']
pack={'schemaVersion':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'weights':{'technicalCorrectness':30,'technicalSpecificity':20,'completeness':15,'architecturalReasoning':15,'clarity':10,'practicalExamples':10},'sources':sources,'cards':cards}
(ROOT/'src/coach/knowledge.js').write_text('(function(root){const data='+json.dumps(pack,ensure_ascii=True,separators=(',',':'))+';if(typeof module!=="undefined"&&module.exports)module.exports=data;else root.CoachKnowledge=data;})(typeof globalThis!=="undefined"?globalThis:this);\n',encoding='utf8')
(ROOT/'benchmarks/technical.json').write_text(json.dumps({'schemaVersion':1,'cases':cases,'notes':['Internal open-book benchmark, not a held-out general-intelligence benchmark.','Reference cards are available to the upgraded retrieval pipeline, but scenario questions and reference answers are not retrieved as benchmark cases.','Automated criterion matching is a heuristic; semantic accuracy requires independent review.']},indent=2),encoding='utf8')
(ROOT/'src/coach/practice-cases.js').write_text('(function(root){const cases='+json.dumps(cases,ensure_ascii=True,separators=(',',':'))+';if(typeof module!=="undefined"&&module.exports)module.exports=cases;else root.CoachCases=cases;})(typeof globalThis!=="undefined"?globalThis:this);\n',encoding='utf8')
print(json.dumps({'cards':len(cards),'cases':len(cases),'adversarial':sum(c['adversarial'] for c in cases),'sourceEvidenceMissing':missing}))
