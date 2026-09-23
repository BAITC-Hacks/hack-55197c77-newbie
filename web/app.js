'use strict';
const $ = (id) => document.getElementById(id);
const groups = [
  ['Транспорт', [['T1','Разгрузка дорог'],['T2','Общественный транспорт']]],
  ['Экология', [['E1','Озеленение'],['E2','Качество воздуха']]],
  ['Социальная инфраструктура', [['S1','Школы и детсады'],['S2','Поликлиники']]],
  ['Безопасность', [['B1','Безопасность улиц'],['B2','Безопасность движения']]],
  ['Городские сервисы', [['C1','Надёжность ЖКХ'],['C2','Обращения жителей']]],
];
const names = Object.fromEntries(groups.flatMap(([, items]) => items));
const directionNames = {transport:'Транспорт',ecology:'Экология',social:'Соцсфера',safety:'Безопасность',services:'Городские сервисы'};
const profiles = {'Есиль':'Сильные городские сервисы, но перегруженные дороги и школы.','Алматы':'Приоритеты района — обновление ЖКХ и снижение пробок.','Сарыарка':'Особого внимания требуют качество воздуха и озеленение.','Байконур':'Сбалансированный район с возможностями улучшения безопасности.','Нура':'Самые низкие стартовые показатели транспорта и социальной инфраструктуры.'};
let data, initial, example, result = null, selected = 'Нура', view = 'before';
let choices = new Map(), revision = 0, pending = false;
let aiResult = null, aiPending = false, aiMessage = 'Проверяем настройки AI…';
const savedScenarioKey = 'akim.scenario-a.v1';
let savedScenario = null, savedResult = null, savedPending = false, savedRevision = 0, savedMessage = '';
const fmt = (n) => n.toLocaleString('ru-RU',{maximumFractionDigits:2});
function element(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=text; return node; }
function current() { return view === 'after' && result ? result : initial; }
function selectedCost() { return data.measures.filter(m=>choices.has(m.id)).reduce((sum,m)=>sum+m.cost,0); }
function status(message, error=false) { $('scenario-status').textContent=message; $('scenario-status').classList.toggle('error',error); $('scenario-status').hidden=!message; }
function invalidate() { revision++; result=null; aiResult=null; aiMessage='После расчёта можно запросить новый AI-анализ.'; view='before'; status(''); renderSummary(); renderMap(); renderDistrict(); renderConclusion(); }
function renderSummary() {
  const cost=selectedCost(), remaining=data.budget-cost;
  const state=current();
  $('city-score').textContent=fmt(state.score);
  $('score-caption').textContent=view==='after'&&result ? `Изменение: ${result.score_change>=0?'+':''}${fmt(result.score_change)} к исходному` : 'Исходное состояние';
  $('budget').textContent=fmt(remaining);
  $('budget-total').textContent=fmt(data.budget);
  $('budget').closest('.metric').classList.toggle('over-budget',remaining<0);
  $('budget').closest('.metric').classList.toggle('low-budget',remaining<=10);
  $('budget-caption').textContent=`Выбрано на ${cost} из ${data.budget} усл. ед.`;
  const budgetWidth=`${Math.max(0,Math.min(100,remaining/data.budget*100))}%`;
  $('budget-bar').style.width=budgetWidth;
  $('selection-budget').textContent=fmt(remaining);
  $('selection-budget-total').textContent=fmt(data.budget);
  $('budget-scale-start').textContent=fmt(data.budget);
  $('selection-count').textContent=`${choices.size} / 5`;
  $('selection-budget-bar').style.width=budgetWidth;
  $('selection-budget-meter').setAttribute('aria-valuemax',String(data.budget));
  $('selection-budget-meter').setAttribute('aria-valuenow',String(Math.max(0,remaining)));
  $('selection-budget-meter').setAttribute('aria-valuetext',`Осталось ${remaining} из ${data.budget} условных единиц`);
  $('decision-budget').dataset.level=remaining<=10?'low':remaining<=25?'warning':'normal';
  $('budget-message').textContent=remaining<0?'Бюджет превышен — снимите часть решений.':remaining===0?'Бюджет исчерпан. Чтобы изменить набор, снимите выбранную меру.':remaining<=10?`Мало средств: осталось ${remaining} усл. ед. Потрачено ${cost}.`:`Потрачено ${cost} · можно выбрать меры ещё на ${remaining} усл. ед.`;
  $('decision-count').textContent=choices.size;
  $('critical-count').textContent=state.critical_count;
  $('critical-caption').textContent=state.critical_count ? 'Точки, которым нужно внимание' : 'Все показатели не ниже 40';
  $('selection-summary').textContent=`Выбрано ${choices.size} из 5 · стоимость ${cost}`;
  $('selection-hint').textContent=cost>data.budget?'Превышен бюджет. Замените или снимите мероприятие.':choices.size===5?'Готово к проверке правил и расчёту.':`Осталось выбрать: ${5-choices.size}.`;
  $('evaluate').disabled=pending||choices.size!==5||cost>data.budget;
  $('evaluate').textContent=pending?'Рассчитываем…':'Рассчитать сценарий ↗';
  $('show-after').disabled=!result;
  $('show-before').setAttribute('aria-pressed',String(view==='before'));
  $('show-after').setAttribute('aria-pressed',String(view==='after'));
  updateMeasureAvailability();
  renderComparison();
}
function copyDecisions(decisions) { return decisions.map(decision=>({...decision})); }
function differenceText(value) {
  if(Math.abs(value)<1e-9)return '0';
  return `${value>0?'+':'−'}${Math.abs(value)<.005?'<0,01':fmt(Math.abs(value))}`;
}
function renderDecisionList(id, decisions) {
  const list=$(id);list.replaceChildren();
  decisions.forEach(decision=>{
    const measure=data.measures.find(item=>item.id===decision.measure);
    list.append(element('li','',`${measure.id} · ${measure.name} — ${measure.scope==='district'?decision.district:'весь город'}`));
  });
}
function renderComparison() {
  $('save-scenario').disabled=!result||pending;
  $('save-scenario').textContent=savedScenario?'Заменить вариант А':'Сохранить как А';
  $('save-scenario').title=result?'Сохранить текущие решения как вариант А':'Сначала рассчитайте допустимый сценарий';
  $('restore-scenario').disabled=!savedResult||pending||savedPending;
  $('retry-scenario').hidden=!savedScenario||Boolean(savedResult)||savedPending;
  $('compare-link').hidden=!savedScenario;
  $('comparison').hidden=!savedScenario&&!result&&!savedMessage;
  $('saved-scenario-status').textContent=savedPending?'Проверяем сохранённый вариант А по текущим правилам…':savedMessage;
  $('comparison-content').hidden=!savedResult;
  if(!savedResult) {
    $('comparison-summary').textContent=savedScenario?'Результаты появятся после проверки сохранённых решений.':'Нажмите «Сохранить как А» рядом с кнопкой расчёта, чтобы зафиксировать первый вариант.';
    return;
  }
  $('scenario-a-score').textContent=`${fmt(savedResult.score)} балла`;
  $('scenario-a-date').textContent=`Сохранён ${new Date(savedScenario.savedAt).toLocaleString('ru-RU')}`;
  renderDecisionList('scenario-a-decisions',savedScenario.decisions);
  renderDecisionList('scenario-b-decisions',[...choices.values()]);
  $('scenario-b-score').textContent=result?`${fmt(result.score)} балла`:'Ожидает расчёта';
  $('scenario-b-state').textContent=result?'Результат текущих пяти решений':'Изменения ещё не рассчитаны. Вариант А сохранён.';
  const delta=result?result.score-savedResult.score:0;
  $('comparison-summary').textContent=!result?'Измените решения и нажмите «Рассчитать сценарий»: здесь появится сравнение с А.':Math.abs(delta)<1e-9?'Score вариантов А и Б совпадает. Сравните распределение пользы по районам.':`По формуле Score вариант ${delta>0?'Б':'А'} выше на ${Math.abs(delta)<.005?'менее 0,01':fmt(Math.abs(delta))} балла. Ниже видно, каким районам стало лучше или хуже в Б.`;
  const rows=[
    ['Балл города · Score',savedResult.score,result?.score,1],
    ['Критические показатели · меньше лучше',savedResult.critical_count,result?.critical_count,-1],
    ['Потрачено, усл. ед.',savedResult.cost,result?.cost,0],
    ['Остаток бюджета, усл. ед.',savedResult.remaining_budget,result?.remaining_budget,0],
    ['Минимальная оценка района',savedResult.weakest_district_score,result?.weakest_district_score,1],
    ...data.districts.map(d=>[d.name,savedResult.district_scores[d.name],result?.district_scores[d.name],1])
  ];
  $('comparison-rows').replaceChildren();
  rows.forEach(([label,a,b,direction])=>{
    const row=element('tr'), heading=element('th','',label);heading.scope='row';
    const difference=b===undefined?null:b-a;
    const tone=difference===null||Math.abs(difference)<1e-9||!direction?'':difference*direction>0?'comparison-better':'comparison-worse';
    row.append(heading,element('td','',fmt(a)),element('td','',b===undefined?'—':fmt(b)),element('td',tone,difference===null?'—':differenceText(difference)));
    $('comparison-rows').append(row);
  });
}
function saveScenario() {
  if(!result||pending)return;
  savedRevision++;savedPending=false;
  savedScenario={version:1,savedAt:new Date().toISOString(),decisions:copyDecisions([...choices.values()])};
  savedResult=JSON.parse(JSON.stringify(result));
  try {
    localStorage.setItem(savedScenarioKey,JSON.stringify(savedScenario));
    savedMessage='Вариант А сохранён в этом браузере. Можно менять Б; А останется доступен после обновления страницы.';
  } catch(error) {
    savedMessage='Браузер не разрешил запись: новый вариант А доступен только до закрытия или обновления страницы.';
  }
  renderComparison();
  $('comparison').scrollIntoView({block:'start',behavior:'smooth'});
}
async function recalculateSavedScenario() {
  if(!savedScenario||savedPending)return;
  const token=++savedRevision, decisions=copyDecisions(savedScenario.decisions);
  savedPending=true;renderComparison();
  try {
    const response=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(decisions)});
    const payload=await response.json();
    if(token!==savedRevision)return;
    if(!response.ok||!payload.valid) {
      savedResult=null;savedMessage='Сохранённый А не прошёл проверку текущих правил. Рассчитайте допустимый набор и замените вариант А.';
    } else {
      savedResult=payload;savedMessage='Сохранённый вариант А загружен из этого браузера и заново рассчитан Python. Нажмите «Восстановить А», чтобы вернуться к его решениям.';
    }
  } catch(error) {
    if(token===savedRevision){savedResult=null;savedMessage='Не удалось проверить сохранённый А. Проверьте, что сервер запущен, и повторите проверку.';}
  } finally {if(token===savedRevision){savedPending=false;renderComparison();}}
}
function loadSavedScenario() {
  let raw;
  try {raw=localStorage.getItem(savedScenarioKey);}
  catch(error){savedMessage='Хранилище браузера недоступно. Сравнение работает в текущем сеансе.';renderComparison();return;}
  if(!raw)return;
  try {
    if(raw.length>8192)throw new Error('size');
    const value=JSON.parse(raw);
    if(value?.version!==1||!Number.isFinite(Date.parse(value.savedAt))||!Array.isArray(value.decisions)||value.decisions.length!==5)throw new Error('format');
    const ids=new Set();
    const decisions=value.decisions.map(decision=>{
      const measure=data.measures.find(m=>m.id===decision?.measure);
      if(!measure||ids.has(measure.id))throw new Error('measure');
      ids.add(measure.id);
      if(measure.scope==='district') {
        if(!data.districts.some(d=>d.name===decision.district))throw new Error('district');
        return {measure:measure.id,district:decision.district};
      }
      return {measure:measure.id};
    });
    savedScenario={version:1,savedAt:new Date(value.savedAt).toISOString(),decisions};
    recalculateSavedScenario();
  } catch(error) {savedMessage='Сохранённый А не удалось прочитать. Рассчитайте новый сценарий и сохраните его как А.';renderComparison();}
}
async function restoreScenario() {
  if(!savedResult||pending||savedPending)return;
  choices=new Map(copyDecisions(savedScenario.decisions).map(d=>[d.measure,d]));
  selected=savedScenario.decisions.find(d=>d.district)?.district||selected;
  invalidate();renderMeasures();
  await calculate();
}
function updateMeasureAvailability() {
  const remaining=data.budget-selectedCost();
  data.measures.forEach(m=>{
    const input=$(`pick-${m.id}`);
    if(!input)return;
    const isSelected=choices.has(m.id), card=input.closest('.measure');
    const reason=!isSelected&&m.cost>remaining?`Не хватает ${m.cost-remaining} усл. ед.`:!isSelected&&choices.size>=5?'Уже выбраны 5 решений':'';
    input.disabled=Boolean(reason);
    card.classList.toggle('is-unavailable',Boolean(reason));
    card.classList.toggle('selected',isSelected);
    const selector=card.querySelector('select');
    if(selector)selector.disabled=Boolean(reason);
    $(`availability-${m.id}`).textContent=isSelected?'Выбрано · можно снять':reason;
  });
}
function renderMap() {
  const state=current();
  document.querySelectorAll('.district').forEach(node=>{
    const name=node.dataset.district, score=state.district_scores[name];
    node.dataset.level=score<50?'low':score<60?'mid':'high';
    node.setAttribute('aria-pressed',String(name===selected));
    node.setAttribute('aria-label',`Район ${name}, оценка ${fmt(score)}`);
    document.querySelector(`[data-score-for="${name}"]`).textContent=fmt(score);
  });
  document.querySelectorAll('#district-picker button').forEach(button=>button.setAttribute('aria-pressed',String(button.textContent===selected)));
}
function chooseDistrict(name) {
  selected=name;renderMap();renderDistrict();
  if(window.matchMedia('(max-width: 760px)').matches) {
    $('district-passport').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
}
function renderDistrict() {
  const district=data.districts.find(d=>d.name===selected), state=current();
  $('district-title').textContent=selected;
  $('district-pop').textContent=`${fmt(district.population_share*100)}% населения`;
  $('district-profile').textContent=profiles[selected];
  $('district-score').textContent=fmt(state.district_scores[selected]);
  const delta=state.district_scores[selected]-initial.district_scores[selected];
  $('district-delta').textContent=view==='after'?`${delta>=0?'+':''}${fmt(delta)} к исходному`:'До мероприятий';
  const critical=Object.values(state.indicators[selected]).filter(value=>value<40).length;
  $('district-condition').textContent=critical?`Показателей ниже 40: ${critical} из 10`:'Все 10 показателей не ниже 40';
  $('district-condition').classList.toggle('has-critical',critical>0);
  $('district-view-label').textContent=view==='after'?'После выбранных решений':'Исходное состояние';
  $('indicators').replaceChildren();
  groups.forEach(([title,items])=>{
    const group=element('section','indicator-group');group.append(element('h3','',title));
    items.forEach(([key,label])=>{
      const before=initial.indicators[selected][key], after=state.indicators[selected][key];
      const row=element('div',`indicator${after<40?' is-critical':''}`);
      const top=element('div','indicator-top'), name=element('span','indicator-name',label);
      if(after<40)name.append(element('span','critical-tag','Критично'));
      top.append(name,element('span','indicator-value',view==='after'?`${fmt(before)} → ${fmt(after)}`:fmt(before)));
      const track=element('div','tracks');track.setAttribute('role','img');track.setAttribute('aria-label',`${label}: исходно ${fmt(before)}, ${view==='after'?'после':'сейчас'} ${fmt(after)} из 100${after<40?', критический уровень':''}`);
      const b=element('i','track-before'),a=element('i','track-after');b.style.width=`${before}%`;a.style.width=`${after}%`;track.append(b,a);row.append(top,track);group.append(row);
    });$('indicators').append(group);
  });
}
function renderMeasures() {
  $('measures').replaceChildren();
  data.measures.forEach(m=>{
    const card=element('article',`measure${choices.has(m.id)?' selected':''}`);
    card.append(element('p','measure-direction',`${m.id} / ${directionNames[m.direction]}`));
    const heading=element('div','measure-heading'), input=element('input');input.type='checkbox';input.id=`pick-${m.id}`;input.checked=choices.has(m.id);input.setAttribute('aria-describedby',`availability-${m.id}`);
    const label=element('label','',m.name);label.htmlFor=input.id;heading.append(input,label);card.append(heading);
    const meta=element('div','measure-meta');meta.append(element('b','',`${m.cost} усл. ед.`),element('span','',`Задержка: ${m.lag} кв.`));card.append(meta);
    let selector;
    if(m.scope==='district') {
      selector=element('select');selector.setAttribute('aria-label',`Район для ${m.id}: ${m.name}`);
      data.districts.forEach(d=>{const option=element('option','',d.name);option.value=d.name;selector.append(option);});
      selector.value=choices.get(m.id)?.district||selected;
      selector.addEventListener('change',()=>{if(choices.has(m.id)){choices.set(m.id,{measure:m.id,district:selector.value});selected=selector.value;invalidate();}});card.append(selector);
    } else card.append(element('p','city-scope','↗ Действует на весь город'));
    card.append(element('p','measure-effects',Object.entries(m.effects).map(([k,v])=>`${names[k]} ${v>=0?'+':''}${v}`).join(' · ')));
    const availability=element('p','measure-availability','');availability.id=`availability-${m.id}`;card.append(availability);
    input.addEventListener('change',()=>{
      if(input.checked&&choices.size>=5){input.checked=false;status('Уже выбрано пять мероприятий. Сначала снимите одно из них.',true);return;}
      if(input.checked&&selectedCost()+m.cost>data.budget){input.checked=false;status(`Для этой меры не хватает бюджета. Осталось ${data.budget-selectedCost()} усл. ед.`,true);updateMeasureAvailability();return;}
      if(input.checked)choices.set(m.id,m.scope==='district'?{measure:m.id,district:selector.value}:{measure:m.id});else choices.delete(m.id);
      if(input.checked&&m.scope==='district')selected=selector.value;
      card.classList.toggle('selected',input.checked);invalidate();
    });$('measures').append(card);
  });
  updateMeasureAvailability();
}
async function calculate() {
  if(pending)return;
  const requestRevision=++revision;
  aiResult=null;aiMessage='Числа рассчитает Python. Для объяснения сценария нажмите «Получить AI-анализ».';
  pending=true;renderSummary();status('');
  try {
    const response=await fetch('/api/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([...choices.values()])});
    const payload=await response.json();
    if(requestRevision!==revision)return;
    if(!response.ok||!payload.valid){result=null;view='before';status((payload.errors||[payload.error||'Не удалось рассчитать сценарий.']).join('\n'),true);}
    else {result=payload;view='after';status(`Сценарий рассчитан. Балл города: ${fmt(result.score)} (${result.score_change>=0?'+':''}${fmt(result.score_change)}). Остаток бюджета: ${result.remaining_budget}.\nНиже — заключение с последствиями каждого решения и возможной реакцией жителей.`);}
  } catch(error) {if(requestRevision===revision){result=null;view='before';status('Нет связи с расчётным сервером. Убедитесь, что web_server.py запущен, и повторите попытку.',true);}}
  finally {pending=false;renderSummary();renderMap();renderDistrict();renderConclusion();}
}
function renderConclusion() {
  const report=result?.conclusion;
  renderAI();
  $('download-status').hidden=true;
  $('conclusion').hidden=!report;
  $('report-link').hidden=!report;
  for(const id of ['direction-conclusions','watchpoint-list','resolved-critical','synergy-conclusions','measure-conclusions'])$(id).replaceChildren();
  if(!report)return;
  $('conclusion-summary').textContent=report.summary;
  $('score-explanation').textContent=report.score_explanation;
  $('conclusion-model-note').textContent=report.model_note;
  $('reaction-note').textContent=report.reaction_note;
  $('conclusion-method').textContent=aiResult ? `Числа рассчитаны Python по датасету. Пояснения направлений и реакций жителей получены от AI (${aiResult.model}). Гипотезы AI могут ошибаться и не меняют Score.` : 'Числа и пояснения ниже сформированы по правилам, без LLM. AI-разбор можно запросить кнопкой выше после настройки доступа.';
  report.directions.forEach(direction=>{
    const card=element('article','direction-conclusion'), heading=element('div','report-row');
    heading.append(element('h4','',direction.title),element('span','pill',`Бюджет: ${direction.spent}`));
    card.append(heading,element('p','',direction.text));
    const aiDirection=aiResult?.report.directions.find(item=>item.id===direction.id);
    if(aiDirection)card.append(element('p','ai-explanation',`AI: ${aiDirection.explanation}`));
    $('direction-conclusions').append(card);
  });
  report.watchpoints.forEach(text=>$('watchpoint-list').append(element('li','',text)));
  if(report.resolved_critical.length){$('resolved-critical').append(element('h4','','Вышли из критической зоны'));report.resolved_critical.forEach(text=>$('resolved-critical').append(element('p','',text)));}
  if(report.synergies.length){$('synergy-conclusions').append(element('h4','','Сработали совместные эффекты'));report.synergies.forEach(item=>$('synergy-conclusions').append(element('p','',item.text)));}
  report.measures.forEach(measure=>{
    const aiMeasure=aiResult?.report.measures.find(item=>item.id===measure.id);
    const card=element('article','measure-conclusion');
    card.append(element('p','eyebrow',`${measure.id} / ${measure.scope} / ${measure.cost} усл. ед.`),element('h4','',measure.name));
    const facts=element('div','measure-facts');facts.append(element('strong','','Эффект по датасету'));
    facts.append(element('p','',measure.effects.map(effect=>`${effect.label}: ${effect.delta>0?'+':''}${fmt(effect.delta)}`).join(' · ')));
    facts.append(element('p','timing',measure.timing));
    facts.append(element('p','effect-note','Изменение от этой меры в каждом затронутом районе, до ограничения 0–100. Бонусы сочетаний указаны отдельно.'));
    card.append(facts,element('p','explanation-source',aiMeasure?'Пояснение AI':'Пояснение по правилам'),element('p','mechanism',aiMeasure?.consequences||measure.mechanism));
    const support=element('div','reaction support');support.append(element('h5','','Кто может поддержать'),element('p','',aiMeasure?.possible_support||measure.possible_support));
    const concerns=element('div','reaction concern');concerns.append(element('h5','','Кто может быть недоволен и почему'),element('p','',aiMeasure?.possible_concerns||measure.possible_concerns));
    card.append(support,concerns);$('measure-conclusions').append(card);
  });
}
function renderAI() {
  $('download-report').disabled=!result||pending||aiPending;
  $('download-report').title=aiPending?'Дождитесь завершения AI-анализа':'Скачать текущий расчёт и полученные пояснения';
  $('analyze-ai').disabled=!result||pending||aiPending||Boolean(aiResult);
  $('analyze-ai').textContent=aiPending?'AI анализирует…':aiResult?'AI-анализ получен':'Получить AI-анализ';
  $('ai-status').textContent=aiPending?'Ожидаем ответ модели. Обычно это занимает до минуты.':aiMessage;
  $('ai-overview').replaceChildren();$('ai-overview').hidden=!aiResult;
  if(!aiResult)return;
  const report=aiResult.report;
  $('ai-overview').append(element('p','ai-summary',report.summary));
  const columns=element('div','ai-columns');
  for(const [key,title] of [['strengths','Сильные стороны'],['risks','Риски и компромиссы'],['recommendations','Что проверить дальше']]) {
    const section=element('section');section.append(element('h4','',title));
    const list=element('ul');report[key].forEach(text=>list.append(element('li','',text)));section.append(list);columns.append(section);
  }
  $('ai-overview').append(columns,element('p','section-note','Ниже пояснения всех направлений и пяти решений обновлены ответом AI. Реакции жителей остаются предположениями; рассчитанные значения не изменились.'));
}
async function analyzeAI() {
  if(!result||pending||aiPending||aiResult)return;
  const requestRevision=revision, decisions=[...choices.values()];
  aiPending=true;renderAI();
  try {
    const configResponse=await fetch('/api/ai/status');
    const config=await configResponse.json();
    if(requestRevision!==revision)return;
    if(!configResponse.ok||!config.configured){aiMessage=config.message||'Не удалось проверить настройки AI.';return;}
    const response=await fetch('/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(decisions)});
    const payload=await response.json();
    if(requestRevision!==revision)return;
    if(!response.ok){aiMessage=payload.error||'AI не ответил. Расчёт сохранён; повторите запрос.';return;}
    aiResult=payload;
    aiMessage=`Ответ AI получен · модель ${payload.model} · ${new Date(payload.generated_at).toLocaleTimeString('ru-RU')}`;
  } catch(error) {
    if(requestRevision===revision)aiMessage='Нет связи с сервером AI-анализа. Расчёт сохранён; повторите запрос.';
  } finally {aiPending=false;renderConclusion();}
}
async function checkAIStatus() {
  const requestRevision=revision;
  try {
    const response=await fetch('/api/ai/status');const payload=await response.json();
    if(requestRevision===revision&&!aiPending&&!aiResult){aiMessage=payload.message||'Не удалось проверить настройки AI.';renderAI();}
  } catch(error) {if(requestRevision===revision){aiMessage='Не удалось проверить настройки AI. Можно повторить запрос после расчёта.';renderAI();}}
}
function buildTextReport() {
  const precise=n=>n.toLocaleString('ru-RU',{maximumFractionDigits:5});
  const signed=n=>`${n>1e-9?'+':''}${precise(Math.abs(n)<1e-9?0:n)}`;
  const lines=['АКИМ НА 5 ЧАСОВ — ОТЧЁТ О СЦЕНАРИИ',`Сформирован: ${new Date().toLocaleString('ru-RU')}`,
    'Учебная модель на синтетических данных. Результат не является прогнозом реальных городских инвестиций.','',
    'ИТОГ РАСЧЁТА',`Балл города: ${precise(initial.score)} → ${precise(result.score)} (изменение ${signed(result.score_change)})`,
    `Потрачено: ${result.cost} из ${data.budget} усл. ед. Остаток: ${result.remaining_budget}.`,
    `Критических показателей ниже 40: ${initial.critical_count} → ${result.critical_count}.`,
    'Горизонт расчёта: 2 года. Числа рассчитаны Python по правилам датасета.','','ВЫБРАННЫЕ РЕШЕНИЯ'];
  const addDecisions=decisions=>decisions.forEach(decision=>{
    const measure=data.measures.find(m=>m.id===decision.measure);
    lines.push(`${measure.id}. ${measure.name} | ${measure.scope==='district'?decision.district:'весь город'} | ${measure.cost} усл. ед. | задержка ${measure.lag} кв.`);
  });
  addDecisions([...choices.values()]);
  lines.push('','ПОКАЗАТЕЛИ РАЙОНОВ: ДО → ПОСЛЕ');
  data.districts.forEach(d=>{
    lines.push('',`${d.name} — оценка ${precise(initial.district_scores[d.name])} → ${precise(result.district_scores[d.name])}`);
    groups.forEach(([group,items])=>{
      lines.push(`  ${group}`);
      items.forEach(([key,label])=>lines.push(`    ${label}: ${precise(initial.indicators[d.name][key])} → ${precise(result.indicators[d.name][key])}${result.indicators[d.name][key]<40?' [ниже критического порога 40]':''}`));
    });
  });
  if(savedScenario&&savedResult) {
    lines.push('','СРАВНЕНИЕ С СОХРАНЁННЫМ ВАРИАНТОМ А',`Вариант А сохранён: ${new Date(savedScenario.savedAt).toLocaleString('ru-RU')}`,
      `Score А: ${precise(savedResult.score)}. Score Б (текущий): ${precise(result.score)}. Б − А: ${signed(result.score-savedResult.score)}.`,
      `Потрачено А / Б: ${savedResult.cost} / ${result.cost}. Остаток А / Б: ${savedResult.remaining_budget} / ${result.remaining_budget}.`,
      `Критических показателей А / Б: ${savedResult.critical_count} / ${result.critical_count}.`,'Решения сохранённого А:');
    addDecisions(savedScenario.decisions);
    lines.push('Оценки районов А → Б:');
    data.districts.forEach(d=>lines.push(`  ${d.name}: ${precise(savedResult.district_scores[d.name])} → ${precise(result.district_scores[d.name])} (${signed(result.district_scores[d.name]-savedResult.district_scores[d.name])})`));
  }
  const conclusion=result.conclusion;
  lines.push('','ЗАКЛЮЧЕНИЕ ПО ПРАВИЛАМ — БЕЗ LLM',conclusion.summary,conclusion.score_explanation,conclusion.model_note,conclusion.reaction_note,'');
  conclusion.directions.forEach(d=>lines.push(`${d.title} (бюджет ${d.spent}): ${d.text}`,''));
  if(conclusion.watchpoints.length)lines.push('На что обратить внимание:',...conclusion.watchpoints.map(text=>`- ${text}`),'');
  if(conclusion.resolved_critical.length)lines.push('Вышли из критической зоны:',...conclusion.resolved_critical.map(text=>`- ${text}`),'');
  if(conclusion.synergies.length)lines.push('Совместные эффекты:',...conclusion.synergies.map(item=>`- ${item.text}`),'');
  conclusion.measures.forEach(m=>{
    lines.push(`${m.id}. ${m.name} — ${m.scope}`,
      `Эффекты по датасету: ${m.effects.map(effect=>`${effect.label}: ${signed(effect.delta)}`).join('; ')}`,
      'Эффекты отдельной меры указаны до ограничения 0–100. Бонусы сочетаний показаны отдельно.',m.timing,m.mechanism,
      `Кто может поддержать: ${m.possible_support}`,`Кто может быть недоволен: ${m.possible_concerns}`,'');
  });
  if(aiResult) {
    const report=aiResult.report;
    lines.push('ОТДЕЛЬНЫЙ AI-АНАЛИЗ',`Модель: ${aiResult.model}. Ответ получен: ${new Date(aiResult.generated_at).toLocaleString('ru-RU')}.`,
      'Текст ниже получен от модели. Возможные реакции жителей — гипотезы, не результаты опроса. AI не изменяет числовой расчёт.',report.summary,'');
    for(const [key,title] of [['strengths','Сильные стороны'],['risks','Риски и компромиссы'],['recommendations','Что проверить дальше']])lines.push(title,...report[key].map(text=>`- ${text}`),'');
    lines.push('AI по направлениям:');
    report.directions.forEach(d=>lines.push(`${directionNames[d.id]||d.id}: ${d.explanation}`,''));
    lines.push('AI по выбранным мерам:');
    report.measures.forEach(m=>lines.push(m.id,m.consequences,`Возможная поддержка: ${m.possible_support}`,`Возможное недовольство: ${m.possible_concerns}`,''));
  } else lines.push('AI-АНАЛИЗ: не запрошен или не получен. Пояснения выше сформированы по правилам.');
  lines.push('','ИСТОЧНИКИ',
    'ТЗ: https://docs.google.com/document/d/1oDZtYnBgbcn_Ii7vleP87hkARJ2HmbXl7Cw_rsCxqpo/edit',
    'Датасет: https://docs.google.com/document/d/1Uc-GdGoKhDY-spu8V50-ZMm33t2CjYLP/edit');
  return lines.join('\n');
}
function downloadReport() {
  if(!result||pending||aiPending)return;
  try {
    const blob=new Blob(['\uFEFF',buildTextReport().replace(/\n/g,'\r\n')],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(blob), link=element('a');
    link.href=url;link.download=`akim-report-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`;
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('download-status').textContent='Отчёт подготовлен для скачивания. Его можно открыть в Блокноте или другом текстовом редакторе.';
  } catch(error) {$('download-status').textContent='Не удалось подготовить файл. Повторите скачивание.';}
  $('download-status').hidden=false;
}
async function init() {
  try {
    const response=await fetch('/api/data');if(!response.ok)throw new Error('data');
    const payload=await response.json();data=payload.data;initial=payload.baseline;example=payload.example;
    data.districts.forEach(d=>{const button=element('button','',d.name);button.addEventListener('click',()=>chooseDistrict(d.name));$('district-picker').append(button);});
    document.querySelectorAll('.district').forEach(node=>{node.addEventListener('click',()=>chooseDistrict(node.dataset.district));node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseDistrict(node.dataset.district);}});});
    $('show-before').addEventListener('click',()=>{view='before';renderSummary();renderMap();renderDistrict();});
    $('show-after').addEventListener('click',()=>{if(result){view='after';renderSummary();renderMap();renderDistrict();}});
    $('example').disabled=false;$('reset').disabled=false;
    $('example').addEventListener('click',()=>{choices=new Map(example.map(d=>[d.measure,{...d}]));invalidate();renderMeasures();status('Пример организаторов загружен. Нажмите «Рассчитать сценарий».');});
    $('reset').addEventListener('click',()=>{choices.clear();invalidate();renderMeasures();});
    $('evaluate').addEventListener('click',calculate);
    $('analyze-ai').addEventListener('click',analyzeAI);
    $('save-scenario').addEventListener('click',saveScenario);
    $('restore-scenario').addEventListener('click',restoreScenario);
    $('retry-scenario').addEventListener('click',recalculateSavedScenario);
    $('download-report').addEventListener('click',downloadReport);
    renderSummary();renderMap();renderDistrict();renderMeasures();
    loadSavedScenario();
    checkAIStatus();
  } catch(error) {$('load-error').hidden=false;$('load-error').textContent='Не удалось загрузить данные. Запустите python web_server.py и обновите страницу.';}
}
init();
