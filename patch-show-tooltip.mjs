import fs from 'node:fs';

// Hover tooltip: when the pointer rests on a musical's name (sidebar list, performance
// cards, the day summary, or the calendar) a card shows the show's poster/logo and a
// short plot description. Both come from the SeatPlan listing via the schedule API
// (show.image / show.description); shows without data simply get no tooltip.

const file='index.html';
let s=fs.readFileSync(file,'utf8');

function mustReplaceAll(search,replacement,label){
  if(!s.includes(search)){
    console.error(`Patch target not found: ${label}`);
    process.exit(1);
  }
  s=s.replaceAll(search,replacement);
}

// Mark every rendered musical name with data-show so one delegated listener can serve them all.
mustReplaceAll(
  '<label for="${id}"><b>${esc(cleanShowTitle(s.name))}</b>',
  '<label for="${id}" data-show="${esc(s.name)}"><b>${esc(cleanShowTitle(s.name))}</b>',
  'sidebar label'
);
mustReplaceAll(
  '<div class="show-title">${esc(cleanShowTitle(name))}</div>',
  '<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}</div>',
  'performance card title'
);
mustReplaceAll(
  'Matinee: <b>${esc(cleanShowTitle(ch.matinee.name))}</b>',
  'Matinee: <b data-show="${esc(ch.matinee.name)}">${esc(cleanShowTitle(ch.matinee.name))}</b>',
  'matinee summary'
);
mustReplaceAll(
  'Evening: <b>${esc(cleanShowTitle(ch.evening.name))}</b>',
  'Evening: <b data-show="${esc(ch.evening.name)}">${esc(cleanShowTitle(ch.evening.name))}</b>',
  'evening summary'
);
mustReplaceAll(
  '<div class="calendar-choice"><b>${icon} ${esc(cleanShowTitle(c.name))}</b>',
  '<div class="calendar-choice"><b data-show="${esc(c.name)}">${icon} ${esc(cleanShowTitle(c.name))}</b>',
  'calendar choice'
);

const css=`
[data-show]{cursor:help}
#showTip{position:fixed;z-index:20000;width:300px;max-width:calc(100vw - 24px);background:var(--paper);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 50px rgba(30,25,20,.22);padding:0;overflow:hidden;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease}
#showTip.on{opacity:1;transform:none}
#showTip img{display:block;width:100%;height:150px;object-fit:cover;background:#eee8df}
#showTip .tip-body{padding:11px 13px 13px}
#showTip .tip-title{font:700 15px Georgia,serif;margin:0 0 5px;color:var(--ink)}
#showTip .tip-desc{font-size:12px;line-height:1.45;color:#4a453e}
#showTip .tip-venue{font-size:11px;color:var(--muted);margin-top:6px}
#showTip .tip-credit{font-size:9px;color:var(--muted);margin-top:7px}
@media(hover:none){#showTip{display:none!important}}
`;
if(!s.includes('#showTip{')) s=s.replace('</style>',css+'</style>');

const js=`
<script>
(()=>{
  if(window.matchMedia&&window.matchMedia('(hover: none)').matches)return;
  const tip=document.createElement('div');
  tip.id='showTip';
  document.body.appendChild(tip);
  let currentName='';
  function metaFor(name){
    try{return showMeta(name)||{}}catch{return {}}
  }
  function build(name){
    const m=metaFor(name);
    const title=typeof cleanShowTitle==='function'?cleanShowTitle(name):name;
    if(!m.image&&!m.description)return false;
    const venue=m.venue&&!/^(London|Broadway, New York|London · West End|New York · Broadway)$/i.test(m.venue)?m.venue:'';
    tip.innerHTML=(m.image?'<img alt="" src="'+esc(m.image)+'">':'')
      +'<div class="tip-body"><div class="tip-title">'+esc(title)+'</div>'
      +(m.description?'<div class="tip-desc">'+esc(m.description)+'</div>':'')
      +(venue?'<div class="tip-venue">🎭 '+esc(venue)+'</div>':'')
      +'<div class="tip-credit">Image and synopsis via SeatPlan</div></div>';
    return true;
  }
  function place(x,y){
    const pad=14,w=tip.offsetWidth||300,h=tip.offsetHeight||200;
    let left=x+pad,top=y+pad;
    if(left+w>window.innerWidth-8)left=Math.max(8,x-w-pad);
    if(top+h>window.innerHeight-8)top=Math.max(8,y-h-pad);
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function hide(){tip.classList.remove('on');currentName=''}
  document.addEventListener('mouseover',e=>{
    const el=e.target.closest&&e.target.closest('[data-show]');
    if(!el)return;
    const name=el.dataset.show||'';
    if(!name)return;
    if(name!==currentName){
      if(!build(name)){hide();return}
      currentName=name;
    }
    tip.classList.add('on');
    place(e.clientX,e.clientY);
  });
  document.addEventListener('mousemove',e=>{
    if(!tip.classList.contains('on'))return;
    const el=e.target.closest&&e.target.closest('[data-show]');
    if(!el||el.dataset.show!==currentName){hide();return}
    place(e.clientX,e.clientY);
  });
  document.addEventListener('mouseout',e=>{
    const el=e.target.closest&&e.target.closest('[data-show]');
    if(!el)return;
    const to=e.relatedTarget&&e.relatedTarget.closest&&e.relatedTarget.closest('[data-show]');
    if(!to||to.dataset.show!==currentName)hide();
  });
  window.addEventListener('scroll',hide,true);
  window.addEventListener('blur',hide);
})();
</script>
`;
if(!s.includes("tip.id='showTip'")) s=s.replace('</body>',js+'</body>');

fs.writeFileSync(file,s);
console.log('Musical hover tooltip (poster + synopsis) applied.');
