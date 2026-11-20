// Cleans raw LLM output so it reads like something a person would actually say.
// Runs on every streamed token, so it must be cheap and tolerate half-finished markdown.

const AI_OPENERS = /^\s*(sure|certainly|of course|great question|good question|absolutely|okay|alright|yeah,? of course)[,.!]?\s+/i;
const LEAD_IN = /^\s*(here'?s|here is|here are)\b[^:\n]{0,60}:\s*/i;

function humanize(text) {
  let t = String(text || '');
  // thinking models: hide reasoning blocks entirely, including unclosed ones mid-stream
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openThink = t.search(/<think>/i);
  if (openThink !== -1) t = t.slice(0, openThink);
  t = t.replace(/```[a-zA-Z0-9+#-]*\n?/g, '');
  t = t.replace(/`/g, '');
  // emphasis markers only — keep snake_case, file_names and 2*3 intact
  t = t.replace(/\*\*/g, '');
  t = t.replace(/(^|\s)\*+(?=\S)/g, '$1').replace(/(\S)\*+(?=\s|$)/g, '$1');
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2');
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s*>\s?/gm, '');
  t = t.replace(/^\s*[-*\u2022]\s+/gm, '');
  t = t.replace(/^\s*\d+[.)]\s+/gm, '');
  t = t.replace(LEAD_IN, '');
  t = t.replace(AI_OPENERS, '');
  t = t.replace(/^["\u201c\u201d]+/, '').replace(/["\u201c\u201d]+\s*$/, '');
  t = t.replace(/\bAs an AI\b[^\n.]*/gi, '');
  t = t.replace(/\b(I'm an AI|I am an AI|language model)\b[^\n.]*/gi, '');
  t = t.replace(/\n{2,}/g, '\n');
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

// Splits an answer into spoken-text and code segments. Prose passes through
// humanize(); code blocks are kept verbatim so fencing and indentation survive.
// An unclosed fence (mid-stream) renders as a growing code block.
function segmentAnswer(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
  const segs = [];
  const fence = /```([a-zA-Z0-9+#.-]*)[ \t]*\n?/g;
  let last = 0;
  let inCode = false;
  let lang = '';
  let m;
  while ((m = fence.exec(t))) {
    if (!inCode) {
      if (m.index > last) segs.push({ type: 'text', text: t.slice(last, m.index) });
      inCode = true;
      lang = m[1];
    } else {
      segs.push({ type: 'code', text: t.slice(last, m.index).replace(/\n$/, ''), lang });
      inCode = false;
    }
    last = fence.lastIndex;
  }
  const tail = t.slice(last);
  if (inCode) segs.push({ type: 'code', text: tail, lang });
  else if (tail) segs.push({ type: 'text', text: tail });
  return segs.map((s) => (s.type === 'code' ? s : { type: 'text', text: humanize(s.text) }));
}
