(function(){
"use strict";

/* =========================================================
   STORAGE
   ========================================================= */
var KEYS = {
  companies:'mcl_companies', experiences:'mcl_experiences', values:'mcl_values',
  sevenDays:'mcl_sevenDays', columns:'mcl_sevenColumns', wordcloud:'mcl_wordcloud'
};
function load(key, fallback){
  try{ var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function save(key, data){
  try{ localStorage.setItem(key, JSON.stringify(data)); }catch(e){ /* storage full or blocked */ }
}
var STATE = {
  companies: load(KEYS.companies, []),
  experiences: load(KEYS.experiences, []),
  values: load(KEYS.values, []),          // [{tag, sources:[{type,id,name,note}]}]
  sevenDays: load(KEYS.sevenDays, null),
  columns: load(KEYS.columns, {value:[],strength:[],weakness:[],challenge:[]}),
  wordcloud: load(KEYS.wordcloud, [])
};
function persistAll(){
  save(KEYS.companies, STATE.companies);
  save(KEYS.experiences, STATE.experiences);
  save(KEYS.values, STATE.values);
  save(KEYS.sevenDays, STATE.sevenDays);
  save(KEYS.columns, STATE.columns);
  save(KEYS.wordcloud, STATE.wordcloud);
  syncToCloud();
}
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
/* =========================================================
   AUTH & CLOUD SYNC (Firebase)
   ========================================================= */
var currentUser = null;

function cloudDocRef(){
  if(!currentUser) return null;
  return window.fireDb.collection('careerLogUsers').doc(currentUser.uid);
}

function syncToCloud(){
  var ref = cloudDocRef();
  if(!ref) return;
  ref.set({
    companies: STATE.companies,
    experiences: STATE.experiences,
    values: STATE.values,
    sevenDays: STATE.sevenDays,
    columns: STATE.columns,
    wordcloud: STATE.wordcloud,
    updatedAt: new Date().toISOString()
  }).catch(function(err){ console.error('クラウド保存に失敗:', err); });
}

function loadFromCloud(){
  var ref = cloudDocRef();
  if(!ref) return;
  ref.get().then(function(doc){
    if(doc.exists){
      var data = doc.data();
      STATE.companies = data.companies || [];
      STATE.experiences = data.experiences || [];
      STATE.values = data.values || [];
      STATE.sevenDays = data.sevenDays || null;
      STATE.columns = data.columns || {value:[],strength:[],weakness:[],challenge:[]};
      STATE.wordcloud = data.wordcloud || [];
      persistAll();
      renderHome();
      toast('クラウドのデータを読み込みました');
    } else {
      syncToCloud();
      toast('このアカウントの初回保存をしました');
    }
  }).catch(function(err){ console.error('クラウド読み込みに失敗:', err); });
}

function updateAuthUI(){
  var authStatus = document.getElementById('authStatus');
  var btnLogin = document.getElementById('btnLogin');
  var authUserName = document.getElementById('authUserName');
  if(currentUser){
    btnLogin.style.display = 'none';
    authStatus.style.display = '';
    authUserName.textContent = currentUser.displayName || currentUser.email || 'ログイン中';
  } else {
    btnLogin.style.display = '';
    authStatus.style.display = 'none';
  }
}

window.fireAuth.onAuthStateChanged(function(user){
  var previousUser = currentUser;
  currentUser = user;
  updateAuthUI();
  if(user){
    loadFromCloud();
  } else if(previousUser){
    clearLocalData();
  }
});

function clearLocalData(){
  STATE.companies = [];
  STATE.experiences = [];
  STATE.values = [];
  STATE.sevenDays = null;
  STATE.columns = {value:[],strength:[],weakness:[],challenge:[]};
  STATE.wordcloud = [];
  persistAll();
  showView('home');
  renderHome();
  toast('ログアウトしました');
}

document.getElementById('btnLogin').addEventListener('click', function(){
  var provider = new firebase.auth.GoogleAuthProvider();
  window.fireAuth.signInWithPopup(provider).catch(function(err){
    console.error('ログインに失敗:', err);
    toast('ログインに失敗しました');
  });
});

document.getElementById('btnLogout').addEventListener('click', function(){
  window.fireAuth.signOut();
});

/* =========================================================
   TOAST
   ========================================================= */
var toastTimer=null;
function toast(msg){
  var el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){ el.classList.remove('show'); }, 2200);
}

/* =========================================================
   VIEW ROUTER
   ========================================================= */
var views = document.querySelectorAll('.view');
var navButtons = document.querySelectorAll('#navTabs button');
function showView(name){
  views.forEach(function(v){ v.classList.toggle('active', v.id === 'view-'+name); });
  navButtons.forEach(function(b){
    var on = b.dataset.view === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true':'false');
  });
  window.scrollTo({top:0, behavior:'smooth'});
  if(name==='companies') renderCompanyList();
  if(name==='ranking') renderRanking();
  if(name==='values') renderValues();
  if(name==='career') renderTimeline();
  if(name==='sevendays') renderSevenDays();
  if(name==='home') renderHome();
}
navButtons.forEach(function(b){
  b.addEventListener('click', function(){ showView(b.dataset.view); });
});
document.querySelectorAll('[data-goto]').forEach(function(b){
  b.addEventListener('click', function(){
    var action=b.dataset.action;
    showView(b.dataset.goto);
    if(action==='new-company'){ openCompanyForm(null); }
    if(action==='new-exp'){ document.getElementById('expForm').style.display='block'; resetExpForm(); }
  });
});

/* =========================================================
   HOME
   ========================================================= */
function layoutCycle(){
  var nodes=[0,1,2,3,4,5];
  var cycleEl=document.querySelector('.cycle');
  var size = cycleEl.clientWidth || 300;
  var r = size*0.46;
  var cx=size/2, cy=size/2;
  nodes.forEach(function(i){
    var angle = (-90 + i*60) * Math.PI/180;
    var x = cx + r*Math.cos(angle);
    var y = cy + r*Math.sin(angle);
    var el = document.getElementById('node'+i);
    if(el){ el.style.left=x+'px'; el.style.top=y+'px'; }
  });
}
function renderHome(){
  document.getElementById('statCompanies').textContent = STATE.companies.length;
  document.getElementById('statExperiences').textContent = STATE.experiences.length;
  document.getElementById('statValues').textContent = STATE.values.length;
  var latest = 0;
  STATE.companies.concat(STATE.experiences).forEach(function(x){ if(x.updatedAt && x.updatedAt>latest) latest=x.updatedAt; });
  var metaEl = document.getElementById('dataMeta');
  metaEl.textContent = latest ? ('最終更新：'+ new Date(latest).toLocaleString('ja-JP')) : 'まだ記録がありません。';
  layoutCycle();
}
window.addEventListener('resize', function(){ if(document.getElementById('view-home').classList.contains('active')) layoutCycle(); });

/* =========================================================
   VALUE TAGS (shared logic)
   ========================================================= */
var CANDIDATE_TAGS = ['#成長','#挑戦','#人との関係','#安定','#裁量','#社会貢献','#技術','#自分らしさ','#働き方','#待遇','#企業文化'];

function normalizeTag(t){
  t = (t||'').trim();
  if(!t) return '';
  if(t[0] !== '#') t = '#'+t;
  return t;
}
function addValueSource(tag, source){
  tag = normalizeTag(tag);
  if(!tag) return;
  var entry = STATE.values.find(function(v){ return v.tag===tag; });
  if(!entry){ entry = {tag:tag, sources:[]}; STATE.values.push(entry); }
  var exists = entry.sources.some(function(s){ return s.type===source.type && s.id===source.id; });
  if(!exists) entry.sources.push(source);
}
function removeValueSource(tag, type, id){
  var entry = STATE.values.find(function(v){ return v.tag===tag; });
  if(!entry) return;
  entry.sources = entry.sources.filter(function(s){ return !(s.type===type && s.id===id); });
  if(entry.sources.length===0){ STATE.values = STATE.values.filter(function(v){ return v.tag!==tag; }); }
}
function syncTagsForRecord(type, id, name, oldTags, newTags){
  (oldTags||[]).forEach(function(t){ if(newTags.indexOf(t)===-1) removeValueSource(t, type, id); });
  newTags.forEach(function(t){ addValueSource(t, {type:type, id:id, name:name}); });
}

/* =========================================================
   COMPANIES
   ========================================================= */
var AXES = [
  {key:'work', label:'仕事内容'},
  {key:'growth', label:'成長できそうか'},
  {key:'culture', label:'人・社風'},
  {key:'worklife', label:'働き方'},
  {key:'authentic', label:'自分らしく働けそうか'}
];
var DEEPDIVE_PROMPTS = [
  'なぜそれを魅力だと感じた？',
  'それが無い会社だったらどう感じる？',
  'その条件はあなたにとってなぜ重要？',
  'これまで似たことを大切にした経験はある？'
];

var currentCompanyId = null;

function blankCompany(){
  return {
    id: uid(), name:'', industry:'', date:'', type:'インターン', url:'', overview:'',
    content:'', learn:'', feelings:[], reflection:'',
    question:'', whyQuestion:'', attraction:'', discomfort:'',
    ratings:{work:0,growth:0,culture:0,worklife:0,authentic:0},
    reasons:{work:'',growth:'',culture:'',worklife:'',authentic:''},
    tags:[], createdAt:Date.now(), updatedAt:Date.now()
  };
}
function companyAvg(c){
  var vals = AXES.map(function(a){ return c.ratings[a.key]||0; }).filter(function(v){ return v>0; });
  if(!vals.length) return 0;
  return vals.reduce(function(a,b){ return a+b; },0)/vals.length;
}
function starString(avg){
  var full = Math.round(avg);
  var s='';
  for(var i=1;i<=5;i++){ s += (i<=full ? '★':'☆'); }
  return s;
}
function renderCompanyList(){
  var grid = document.getElementById('companyGrid');
  var empty = document.getElementById('companyEmpty');
  grid.innerHTML='';
  if(!STATE.companies.length){ empty.style.display='block'; return; }
  empty.style.display='none';
  STATE.companies.slice().sort(function(a,b){ return b.updatedAt-a.updatedAt; }).forEach(function(c){
    var avg = companyAvg(c);
    var card = document.createElement('button');
    card.type='button';
    card.className='note-card';
    card.innerHTML =
      '<img class="nc-fox" src="img/fox.png" alt="チベットスナギツネ">'+
      '<h3>'+escapeHtml(c.name || '（名称未設定）')+'</h3>'+
      '<div class="nc-meta">'+escapeHtml(c.type||'')+(c.date? ' ・ '+escapeHtml(c.date):'')+'</div>'+
      '<div class="nc-stars">'+(avg? starString(avg)+' '+avg.toFixed(1) : '未評価')+'</div>'+
      '<div class="nc-tags">'+ (c.tags||[]).slice(0,4).map(function(t){ return '<span class="chip small tagchip">'+escapeHtml(t)+'</span>'; }).join('') +'</div>';
    card.addEventListener('click', function(){ openCompanyForm(c.id); });
    grid.appendChild(card);
  });
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
}

function openCompanyForm(id){
  var c;
  if(id){ c = STATE.companies.find(function(x){ return x.id===id; }); }
  if(!c){ c = blankCompany(); STATE.companies.push(c); }
  currentCompanyId = c.id;
  document.getElementById('cName').value = c.name;
  document.getElementById('cIndustry').value = c.industry;
  document.getElementById('cDate').value = c.date;
  document.getElementById('cType').value = c.type;
  document.getElementById('cUrl').value = c.url;
  document.getElementById('cOverview').value = c.overview;
  document.getElementById('cContent').value = c.content;
  document.getElementById('cLearn').value = c.learn;
  document.getElementById('cReflection').value = c.reflection;
  document.getElementById('cQuestion').value = c.question;
  document.getElementById('cWhyQuestion').value = c.whyQuestion;
  document.getElementById('cAttraction').value = c.attraction;
  document.getElementById('cDiscomfort').value = c.discomfort;
  document.querySelectorAll('#cFeelChips .chip').forEach(function(chip){
    chip.setAttribute('aria-pressed', c.feelings.indexOf(chip.dataset.feel)>-1 ? 'true':'false');
  });
  buildAxisBlocks(c);
  buildCandidateTags('cCandidateTags', c.tags);
  renderSelectedTags('cSelectedTags', c);
  updateAvgDisplay(c);
  showView('company-detail');
}
document.getElementById('btnNewCompany').addEventListener('click', function(){ openCompanyForm(null); });
document.getElementById('btnBackToList').addEventListener('click', function(){ showView('companies'); });

document.getElementById('cFeelChips').addEventListener('click', function(e){
  var chip = e.target.closest('.chip'); if(!chip) return;
  var on = chip.getAttribute('aria-pressed')==='true';
  chip.setAttribute('aria-pressed', on ? 'false':'true');
});

function buildAxisBlocks(c){
  var wrap = document.getElementById('axisBlocks');
  wrap.innerHTML='';
  AXES.forEach(function(axis){
    var block = document.createElement('div');
    block.className='axis-block';
    var starsHtml='';
    for(var i=1;i<=5;i++){ starsHtml += '<button type="button" class="star-btn" data-axis="'+axis.key+'" data-val="'+i+'">★</button>'; }
    block.innerHTML =
      '<div class="axis-head"><strong>'+axis.label+'</strong><span class="stars">'+starsHtml+'<span class="rating-label" id="lbl-'+axis.key+'"></span></span></div>'+
      '<div class="field" style="margin:0.6rem 0 0;"><label for="reason-'+axis.key+'">なぜ、この評価をつけた？</label><textarea id="reason-'+axis.key+'" data-axis-reason="'+axis.key+'"></textarea></div>'+
      '<button type="button" class="btn small ghost" data-deepdive-toggle="'+axis.key+'">もう少し考える</button>'+
      '<div class="deepdive-box" id="deepdive-'+axis.key+'" style="display:none;"><ul>'+
        DEEPDIVE_PROMPTS.map(function(p){ return '<li>'+p+'</li>'; }).join('') +
      '</ul></div>';
    wrap.appendChild(block);
    document.getElementById('reason-'+axis.key).value = c.reasons[axis.key]||'';
    setAxisStars(axis.key, c.ratings[axis.key]||0);
  });
  wrap.querySelectorAll('.star-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      setAxisStars(btn.dataset.axis, parseInt(btn.dataset.val,10));
      var c2 = STATE.companies.find(function(x){ return x.id===currentCompanyId; });
      if(c2){ c2.ratings[btn.dataset.axis] = parseInt(btn.dataset.val,10); updateAvgDisplay(c2); }
    });
  });
  wrap.querySelectorAll('[data-deepdive-toggle]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var box = document.getElementById('deepdive-'+btn.dataset.deepdiveToggle);
      box.style.display = box.style.display==='none' ? 'block' : 'none';
    });
  });
}
function setAxisStars(axisKey, val){
  var wrap = document.querySelectorAll('[data-axis="'+axisKey+'"]');
  wrap.forEach(function(b){ b.classList.toggle('on', parseInt(b.dataset.val,10) <= val); });
  var lbl = document.getElementById('lbl-'+axisKey);
  if(lbl) lbl.textContent = val ? val+' / 5' : '未評価';
}
function updateAvgDisplay(c){
  var avg = companyAvg(c);
  document.getElementById('cAvgDisplay').textContent = avg ? starString(avg)+' '+avg.toFixed(1) : '未評価';
}

function buildCandidateTags(containerId, selected){
  var wrap = document.getElementById(containerId);
  wrap.innerHTML='';
  CANDIDATE_TAGS.forEach(function(t){
    var chip=document.createElement('button');
    chip.type='button'; chip.className='chip small';
    chip.textContent=t;
    chip.setAttribute('aria-pressed', selected.indexOf(t)>-1 ? 'true':'false');
    chip.addEventListener('click', function(){
      var on = chip.getAttribute('aria-pressed')==='true';
      chip.setAttribute('aria-pressed', on?'false':'true');
      var c = STATE.companies.find(function(x){ return x.id===currentCompanyId; });
      var e = STATE.experiences.find(function(x){ return x.id===currentExpId; });
      var target = containerId==='cCandidateTags' ? c : e;
      if(!target) return;
      if(on){ target.tags = target.tags.filter(function(x){ return x!==t; }); }
      else{ target.tags.push(t); }
      if(containerId==='cCandidateTags') renderSelectedTags('cSelectedTags', c);
      else renderSelectedTags('eSelectedTags', e);
    });
    wrap.appendChild(chip);
  });
}
function renderSelectedTags(containerId, record){
  var wrap = document.getElementById(containerId);
  wrap.innerHTML='';
  (record.tags||[]).forEach(function(t){
    var chip=document.createElement('span');
    chip.className='chip small tagchip removable';
    chip.innerHTML = escapeHtml(t)+' <span class="x">×</span>';
    chip.addEventListener('click', function(){
      record.tags = record.tags.filter(function(x){ return x!==t; });
      renderSelectedTags(containerId, record);
      var candWrap = containerId==='cSelectedTags' ? document.getElementById('cCandidateTags') : document.getElementById('eCandidateTags');
      candWrap.querySelectorAll('.chip').forEach(function(c2){ if(c2.textContent===t) c2.setAttribute('aria-pressed','false'); });
    });
    wrap.appendChild(chip);
  });
}
document.getElementById('btnAddCustomTag').addEventListener('click', function(){
  var input = document.getElementById('cCustomTag');
  var t = normalizeTag(input.value);
  if(!t) return;
  var c = STATE.companies.find(function(x){ return x.id===currentCompanyId; });
  if(c && c.tags.indexOf(t)===-1){ c.tags.push(t); renderSelectedTags('cSelectedTags', c); }
  input.value='';
});

document.getElementById('btnSaveCompany').addEventListener('click', function(){
  var c = STATE.companies.find(function(x){ return x.id===currentCompanyId; });
  if(!c) return;
  var oldTags = c.tags.slice();
  c.name = document.getElementById('cName').value.trim();
  c.industry = document.getElementById('cIndustry').value.trim();
  c.date = document.getElementById('cDate').value;
  c.type = document.getElementById('cType').value;
  c.url = document.getElementById('cUrl').value.trim();
  c.overview = document.getElementById('cOverview').value;
  c.content = document.getElementById('cContent').value;
  c.learn = document.getElementById('cLearn').value;
  c.reflection = document.getElementById('cReflection').value;
  c.question = document.getElementById('cQuestion').value;
  c.whyQuestion = document.getElementById('cWhyQuestion').value;
  c.attraction = document.getElementById('cAttraction').value;
  c.discomfort = document.getElementById('cDiscomfort').value;
  c.feelings = Array.prototype.slice.call(document.querySelectorAll('#cFeelChips .chip'))
    .filter(function(ch){ return ch.getAttribute('aria-pressed')==='true'; }).map(function(ch){ return ch.dataset.feel; });
  AXES.forEach(function(axis){ c.reasons[axis.key] = document.getElementById('reason-'+axis.key).value; });
  if(!c.name){ toast('会社名を入力してください'); return; }
  c.updatedAt = Date.now();
  syncTagsForRecord('company', c.id, c.name, oldTags, c.tags);
  persistAll();
  toast('保存しました');
  showView('companies');
});
document.getElementById('btnDeleteCompany').addEventListener('click', function(){
  if(!currentCompanyId) return;
  if(!confirm('この企業ノートを削除しますか？')) return;
  var c = STATE.companies.find(function(x){ return x.id===currentCompanyId; });
  if(c){ syncTagsForRecord('company', c.id, c.name, c.tags, []); }
  STATE.companies = STATE.companies.filter(function(x){ return x.id!==currentCompanyId; });
  persistAll();
  toast('削除しました');
  showView('companies');
});

/* =========================================================
   RANKING
   ========================================================= */
function renderRanking(){
  var list = document.getElementById('rankingList');
  var empty = document.getElementById('rankingEmpty');
  list.innerHTML='';
  var rated = STATE.companies.filter(function(c){ return companyAvg(c)>0; })
    .sort(function(a,b){ return companyAvg(b)-companyAvg(a); });
  if(!rated.length){ empty.style.display='block'; return; }
  empty.style.display='none';
  rated.forEach(function(c, idx){
    var avg = companyAvg(c);
    var topAxis = AXES.slice().sort(function(a,b){ return (c.ratings[b.key]||0)-(c.ratings[a.key]||0); })[0];
    var reason = c.reasons[topAxis.key] || c.attraction || '';
    var item = document.createElement('div');
    item.className='rank-item';
    item.innerHTML =
      '<div class="rank-num">'+(idx+1)+'</div>'+
      '<div class="rank-body">'+
        '<h3>'+escapeHtml(c.name)+'</h3>'+
        '<div class="rank-stars">'+starString(avg)+' '+avg.toFixed(1)+'</div>'+
        '<div class="rank-top-axis">最も高かった評価項目：'+topAxis.label+'</div>'+
        (reason ? '<div class="rank-reason">魅力に感じた理由：'+escapeHtml(reason)+'</div>' : '')+
      '</div>';
    item.style.cursor='pointer';
    item.addEventListener('click', function(){ openCompanyForm(c.id); });
    list.appendChild(item);
  });
}

/* =========================================================
   MY VALUES
   ========================================================= */
function renderValues(){
  var wrap = document.getElementById('valueCloud');
  var empty = document.getElementById('valuesEmpty');
  var detail = document.getElementById('valueDetail');
  wrap.innerHTML=''; detail.style.display='none'; detail.innerHTML='';
  if(!STATE.values.length){ empty.style.display='block'; return; }
  empty.style.display='none';
  var sorted = STATE.values.slice().sort(function(a,b){ return b.sources.length-a.sources.length; });
  var max = sorted[0].sources.length;
  sorted.forEach(function(v){
    var chip = document.createElement('button');
    chip.type='button'; chip.className='value-chip';
    var scale = 0.85 + (v.sources.length/max)*0.9;
    chip.style.fontSize = scale.toFixed(2)+'rem';
    chip.textContent = v.tag + '（'+v.sources.length+'）';
    chip.addEventListener('click', function(){
      detail.style.display='block';
      detail.innerHTML = '<strong>'+escapeHtml(v.tag)+'</strong> はここから見つかりました：<ul>'+
        v.sources.map(function(s){ return '<li>'+ (s.type==='company'?'企業ノート':(s.type==='experience'?'キャリアログ':'7日間の記録')) +'「'+escapeHtml(s.name||'')+'」</li>'; }).join('') +
      '</ul>';
    });
    wrap.appendChild(chip);
  });
}

/* =========================================================
   CAREER LOG (experiences)
   ========================================================= */
var currentExpId = null;
function resetExpForm(){
  currentExpId = uid();
  document.getElementById('eDate').value='';
  document.getElementById('eType').value='会社説明会';
  document.getElementById('eTitle').value='';
  ['eWhat','eFeel','eWhy','ePart','eAwareness','eNext'].forEach(function(id){ document.getElementById(id).value=''; });
  var tmp = {id: currentExpId, tags:[]};
  STATE._draftExp = tmp;
  buildCandidateTags('eCandidateTags', []);
  renderSelectedTags('eSelectedTags', tmp);
}
document.getElementById('btnNewExp').addEventListener('click', function(){
  document.getElementById('expForm').style.display='block';
  resetExpForm();
  document.getElementById('expForm').scrollIntoView({behavior:'smooth'});
});
document.getElementById('btnCancelExp').addEventListener('click', function(){
  document.getElementById('expForm').style.display='none';
});
document.getElementById('btnAddExpTag').addEventListener('click', function(){
  var input = document.getElementById('eCustomTag');
  var t = normalizeTag(input.value);
  if(!t) return;
  var draft = STATE._draftExp;
  if(draft && draft.tags.indexOf(t)===-1){ draft.tags.push(t); renderSelectedTags('eSelectedTags', draft); }
  input.value='';
});
document.getElementById('btnSaveExp').addEventListener('click', function(){
  var title = document.getElementById('eTitle').value.trim();
  if(!title){ toast('タイトルを入力してください'); return; }
  var draft = STATE._draftExp || {tags:[]};
  var exp = {
    id: currentExpId, date: document.getElementById('eDate').value, type: document.getElementById('eType').value,
    title: title, what: document.getElementById('eWhat').value, feel: document.getElementById('eFeel').value,
    why: document.getElementById('eWhy').value, part: document.getElementById('ePart').value,
    awareness: document.getElementById('eAwareness').value, next: document.getElementById('eNext').value,
    tags: draft.tags.slice(), createdAt: Date.now(), updatedAt: Date.now()
  };
  STATE.experiences.push(exp);
  syncTagsForRecord('experience', exp.id, exp.title, [], exp.tags);
  persistAll();
  document.getElementById('expForm').style.display='none';
  toast('記録しました');
  renderTimeline();
});
function renderTimeline(){
  var wrap = document.getElementById('timeline');
  var empty = document.getElementById('timelineEmpty');
  wrap.innerHTML='';
  var list = STATE.experiences.slice().sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
  if(!list.length){ empty.style.display='block'; return; }
  empty.style.display='none';
  list.forEach(function(e){
    var item=document.createElement('div');
    item.className='tl-item';
    item.innerHTML =
      '<div class="tl-date">'+escapeHtml(e.date||'')+'　'+escapeHtml(e.type||'')+'</div>'+
      '<div class="tl-title">'+escapeHtml(e.title)+'</div>'+
      (e.awareness ? '<div class="tl-arrow">↓</div><div class="tl-awareness">'+escapeHtml(e.awareness)+'</div>' : '')+
      '<div class="tl-tags">'+ (e.tags||[]).map(function(t){ return '<span class="chip small tagchip">'+escapeHtml(t)+'</span>'; }).join('') +'</div>';
    wrap.appendChild(item);
  });
}

/* =========================================================
   SEVEN DAYS
   ========================================================= */
function renderSevenDays(){
  var s = STATE.sevenDays;
  if(s){
    document.getElementById('sEvent').value = s.event||'';
    document.getElementById('sFeelNote').value = s.feelNote||'';
    document.getElementById('sWhy').value = s.why||'';
    document.getElementById('sQ').value = s.question||'';
    document.getElementById('sWhyQ').value = s.whyQuestion||'';
    document.getElementById('sNew').value = s.newAwareness||'';
    document.getElementById('sGrow').value = s.grow||'';
    document.getElementById('sRely').value = s.rely||'';
    document.querySelectorAll('#sFeelChips .chip').forEach(function(chip){
      chip.setAttribute('aria-pressed', (s.feelings||[]).indexOf(chip.dataset.feel)>-1 ? 'true':'false');
    });
  }
  renderColumns();
  renderRecap();
}
document.getElementById('sFeelChips').addEventListener('click', function(e){
  var chip = e.target.closest('.chip'); if(!chip) return;
  var on = chip.getAttribute('aria-pressed')==='true';
  chip.setAttribute('aria-pressed', on?'false':'true');
});
document.getElementById('btnSaveSeven').addEventListener('click', function(){
  STATE.sevenDays = {
    event: document.getElementById('sEvent').value,
    feelings: Array.prototype.slice.call(document.querySelectorAll('#sFeelChips .chip')).filter(function(c){ return c.getAttribute('aria-pressed')==='true'; }).map(function(c){ return c.dataset.feel; }),
    feelNote: document.getElementById('sFeelNote').value,
    why: document.getElementById('sWhy').value,
    question: document.getElementById('sQ').value,
    whyQuestion: document.getElementById('sWhyQ').value,
    newAwareness: document.getElementById('sNew').value,
    grow: document.getElementById('sGrow').value,
    rely: document.getElementById('sRely').value,
    savedAt: Date.now()
  };
  persistAll();
  toast('7日間の記録を保存しました');
  renderRecap();
});

var COL_MAP = {value:'colValue', strength:'colStrength', weakness:'colWeakness', challenge:'colChallenge'};
function renderColumns(){
  Object.keys(COL_MAP).forEach(function(key){
    var wrap = document.getElementById(COL_MAP[key]);
    wrap.innerHTML='';
    (STATE.columns[key]||[]).forEach(function(item){
      var chip=document.createElement('span');
      chip.className='chip small removable';
      chip.innerHTML = escapeHtml(item)+' <span class="x">×</span>';
      chip.addEventListener('click', function(){
        STATE.columns[key] = STATE.columns[key].filter(function(x){ return x!==item; });
        persistAll(); renderColumns(); renderRecap();
      });
      wrap.appendChild(chip);
    });
  });
}
document.querySelectorAll('.value-col .mini-add button').forEach(function(btn){
  btn.addEventListener('click', function(){
    var key = btn.dataset.col;
    var input = document.getElementById('add'+key.charAt(0).toUpperCase()+key.slice(1));
    var val = input.value.trim();
    if(!val) return;
    if(!STATE.columns[key]) STATE.columns[key]=[];
    if(STATE.columns[key].indexOf(val)===-1) STATE.columns[key].push(val);
    if(key==='value'){ addValueSource(normalizeTag(val), {type:'sevendays', id:'sevendays', name:'7日間の記録'}); }
    input.value='';
    persistAll(); renderColumns(); renderRecap();
  });
});
document.getElementById('nextChallengeChips').addEventListener('click', function(e){
  var chip = e.target.closest('.chip'); if(!chip) return;
  var val = chip.dataset.nc;
  if(!STATE.columns.challenge) STATE.columns.challenge=[];
  if(STATE.columns.challenge.indexOf(val)===-1){ STATE.columns.challenge.push(val); persistAll(); renderColumns(); toast('CHALLENGEに追加しました'); }
});

function renderRecap(){
  var s = STATE.sevenDays;
  var body = document.getElementById('recapBody');
  if(!s){ body.innerHTML = '<p class="hint">上のフォームを保存すると、ここに記録がまとまります。</p>'; return; }
  function block(label, val){
    if(!val) return '';
    return '<div class="recap-block"><div class="rb-label">'+label+'</div><div class="rb-body">'+escapeHtml(val)+'</div></div>';
  }
  body.innerHTML =
    block('印象に残っている出来事', s.event) +
    block('感じたこと', (s.feelings||[]).join('・') + (s.feelNote? '　'+s.feelNote:'')) +
    block('見つけた強み・気づき', s.newAwareness) +
    block('大切にしたい価値観', (STATE.columns.value||[]).join('　')) +
    block('次の挑戦', (STATE.columns.challenge||[]).join('　'));
}
document.getElementById('btnPrintRecap').addEventListener('click', function(){
  window.print();
});
(function observeRecapReveal(){
  var target = document.getElementById('recapFinal');
  var steps = target.querySelectorAll('.step');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){
        steps.forEach(function(st, i){ setTimeout(function(){ st.classList.add('show'); }, i*450); });
        io.disconnect();
      }
    });
  }, {threshold:0.5});
  io.observe(target);
})();

/* =========================================================
   WORD CLOUD
   ========================================================= */
/* WC_BACKEND: 現在はローカル（同一ブラウザのタブ間のみ）で共有します。
   複数人のスマートフォンから1つの発表画面へリアルタイム送信したい場合は、
   Firebase Realtime Database 等を用意し、以下2関数の中身を置き換えてください。
     1) wcBroadcastSend(word)  … 送信時に呼ばれる
     2) wcBroadcastOnReceive(callback) … 他端末からの受信時に callback(word) を呼ぶ
   例）Firebaseの場合は push()/onChildAdded() を使って実装します。 */
var wcChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('mcl_wordcloud_channel') : null;
function wcBroadcastSend(word){
  if(wcChannel) wcChannel.postMessage({word:word, ts:Date.now()});
}
function wcBroadcastOnReceive(cb){
  if(wcChannel){ wcChannel.onmessage = function(e){ cb(e.data.word); }; }
}
function wcAddWord(word, fromRemote){
  word = word.trim();
  if(!word) return;
  STATE.wordcloud.push({word:word, ts:Date.now()});
  save(KEYS.wordcloud, STATE.wordcloud);
  spawnWord(word);
  if(!fromRemote) wcBroadcastSend(word);
}
function spawnWord(word){
  var stage = document.getElementById('wcStage');
  var norm = word.trim().toLowerCase();
  var count = STATE.wordcloud.filter(function(w){ return w.word.trim().toLowerCase()===norm; }).length;
  var size = Math.min(2.2, 0.95 + count*0.22);
  var el = document.createElement('div');
  el.className='wc-word';
  el.textContent = word;
  el.style.fontSize = size+'rem';
  var maxX = Math.max(stage.clientWidth - 140, 20);
  var maxY = Math.max(stage.clientHeight - 60, 20);
  el.style.left = (10+Math.random()*maxX)+'px';
  el.style.top = (10+Math.random()*maxY)+'px';
  el.style.animation = 'popIn 0.5s ease, popfloat '+(5+Math.random()*3)+'s ease-in-out '+0.5+'s infinite';
  stage.appendChild(el);
}
function replayWordcloud(){
  var stage = document.getElementById('wcStage');
  Array.prototype.slice.call(stage.querySelectorAll('.wc-word')).forEach(function(el){ el.remove(); });
  STATE.wordcloud.forEach(function(w){ spawnWord(w.word); });
}
document.getElementById('wcSubmit').addEventListener('click', function(){
  var input = document.getElementById('wcInput');
  wcAddWord(input.value);
  input.value='';
});
document.getElementById('wcInput').addEventListener('keydown', function(e){
  if(e.key==='Enter'){ document.getElementById('wcSubmit').click(); }
});
wcBroadcastOnReceive(function(word){ wcAddWord(word, true); });
document.getElementById('btnRevealWc').addEventListener('click', function(){
  var stage = document.getElementById('wcStage');
  var layer = document.getElementById('wcRevealLayer');
  stage.classList.add('dim');
  layer.style.display='flex';
  var steps = layer.querySelectorAll('.step');
  steps.forEach(function(st){ st.classList.remove('show'); });
  steps.forEach(function(st, i){ setTimeout(function(){ st.classList.add('show'); }, i*700); });
});
document.getElementById('btnResetWc').addEventListener('click', function(){
  if(!confirm('この端末に保存されているやりがいの回答をすべて消しますか？')) return;
  STATE.wordcloud = [];
  save(KEYS.wordcloud, []);
  var stage = document.getElementById('wcStage');
  Array.prototype.slice.call(stage.querySelectorAll('.wc-word')).forEach(function(el){ el.remove(); });
  stage.classList.remove('dim');
  document.getElementById('wcRevealLayer').style.display='none';
});

/* =========================================================
   EXPORT / IMPORT
   ========================================================= */
document.getElementById('btnExport').addEventListener('click', function(){
  var data = {
    companies: STATE.companies, experiences: STATE.experiences, values: STATE.values,
    sevenDays: STATE.sevenDays, columns: STATE.columns, wordcloud: STATE.wordcloud,
    exportedAt: new Date().toISOString(), appName:'MY CAREER LOG'
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href=url; a.download='my_career_data_'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('書き出しました');
});
document.getElementById('btnImportTrigger').addEventListener('click', function(){
  document.getElementById('fileImport').click();
});
document.getElementById('fileImport').addEventListener('change', function(e){
  var file = e.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var data = JSON.parse(reader.result);
      if(!confirm('現在のデータに読み込んだ内容をマージします。よろしいですか？')) return;
      STATE.companies = STATE.companies.concat(data.companies||[]);
      STATE.experiences = STATE.experiences.concat(data.experiences||[]);
      (data.values||[]).forEach(function(v){ v.sources.forEach(function(s){ addValueSource(v.tag, s); }); });
      if(data.sevenDays && !STATE.sevenDays) STATE.sevenDays = data.sevenDays;
      if(data.columns){
        Object.keys(data.columns).forEach(function(k){
          STATE.columns[k] = Array.from(new Set((STATE.columns[k]||[]).concat(data.columns[k]||[])));
        });
      }
      STATE.wordcloud = STATE.wordcloud.concat(data.wordcloud||[]);
      persistAll();
      toast('読み込みました');
      renderHome();
    }catch(err){ toast('読み込みに失敗しました'); }
  };
  reader.readAsText(file);
  e.target.value='';
});

/* =========================================================
   INIT
   ========================================================= */
renderHome();
})();