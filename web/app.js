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
const fmt = (n) => n.toLocaleString('ru-RU',{maximumFractionDigits:2});
function element(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className; if(text!==undefined)node.textContent=text; return node; }
function current() { return view === 'after' && result ? result : initial; }
function status(message, error=false) { $('scenario-status').textContent=message; $('scenario-status').classList.toggle('error',error); $('scenario-status').hidden=!message; }
function invalidate() { revision++; result=null; view='before'; status(''); renderSummary(); renderMap(); renderDistrict(); renderConclusion(); }
function renderSummary() {
  const cost=data.measures.filter(m=>choices.has(m.id)).reduce((sum,m)=>sum+m.cost,0);
  const state=current();
  $('city-score').textContent=fmt(state.score);
  $('score-caption').textContent=view==='after'&&result ? `Изменение: ${result.score_change>=0?'+':''}${fmt(result.score_change)} к исходному` : 'Исходное состояние';
  $('budget').textContent=fmt(data.budget-cost);
  $('budget').closest('.metric').classList.toggle('over-budget',cost>data.budget);
  $('budget-caption').textContent=`Выбрано на ${cost} из ${data.budget} усл. ед.`;
  $('budget-bar').style.width=`${Math.max(0,(data.budget-cost)/data.budget*100)}%`;
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
}
function renderMap() {
  const state=current();
  document.querySelectorAll('.district').forEach(node=>{
    const name=node.dataset.district, score=state.district_scores[name];
    node.dataset.level=score<50?'low':score<60?'mid':'high';
    node.setAttribute('aria-pressed',String(name===selected));
    node.setAttribute('aria-label',`Район ${name}, оценка ${fmt(score)}`);
    node.querySelector('.map-score').textContent=fmt(score);
  });
  document.querySelectorAll('#district-picker button').forEach(button=>button.setAttribute('aria-pressed',String(button.textContent===selected)));
}
function chooseDistrict(name) {selected=name;renderMap();renderDistrict();}
function renderDistrict() {
  const district=data.districts.find(d=>d.name===selected), state=current();
  $('district-title').textContent=selected;
  $('district-pop').textContent=`${fmt(district.population_share*100)}% населения`;
  $('district-profile').textContent=profiles[selected];
  $('district-score').textContent=fmt(state.district_scores[selected]);
  const delta=state.district_scores[selected]-initial.district_scores[selected];
  $('district-delta').textContent=view==='after'?`${delta>=0?'+':''}${fmt(delta)} к исходному`:'До мероприятий';
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
    const heading=element('div','measure-heading'), input=element('input');input.type='checkbox';input.id=`pick-${m.id}`;input.checked=choices.has(m.id);
    const label=element('label','',m.name);label.htmlFor=input.id;heading.append(input,label);card.append(heading);
    const meta=element('div','measure-meta');meta.append(element('b','',`${m.cost} усл. ед.`),element('span','',`Задержка: ${m.lag} кв.`));card.append(meta);
    let selector;
    if(m.scope==='district') {
      selector=element('select');selector.setAttribute('aria-label',`Район для ${m.id}: ${m.name}`);
      data.districts.forEach(d=>{const option=element('option','',d.name);option.value=d.name;selector.append(option);});
      selector.value=choices.get(m.id)?.district||selected;
      selector.addEventListener('change',()=>{if(choices.has(m.id)){choices.set(m.id,{measure:m.id,district:selector.value});invalidate();}});card.append(selector);
    } else card.append(element('p','city-scope','↗ Действует на весь город'));
    card.append(element('p','measure-effects',Object.entries(m.effects).map(([k,v])=>`${names[k]} ${v>=0?'+':''}${v}`).join(' · ')));
    input.addEventListener('change',()=>{
      if(input.checked&&choices.size>=5){input.checked=false;status('Уже выбрано пять мероприятий. Сначала снимите одно из них.',true);return;}
      if(input.checked)choices.set(m.id,m.scope==='district'?{measure:m.id,district:selector.value}:{measure:m.id});else choices.delete(m.id);
      card.classList.toggle('selected',input.checked);invalidate();
    });$('measures').append(card);
  });
}
async function calculate() {
  if(pending)return;
  const requestRevision=revision;
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
  $('conclusion').hidden=!report;
  $('report-link').hidden=!report;
  for(const id of ['direction-conclusions','watchpoint-list','resolved-critical','synergy-conclusions','measure-conclusions'])$(id).replaceChildren();
  if(!report)return;
  $('conclusion-summary').textContent=report.summary;
  $('score-explanation').textContent=report.score_explanation;
  $('conclusion-model-note').textContent=report.model_note;
  $('reaction-note').textContent=report.reaction_note;
  $('conclusion-method').textContent=report.method_note;
  report.directions.forEach(direction=>{
    const card=element('article','direction-conclusion'), heading=element('div','report-row');
    heading.append(element('h4','',direction.title),element('span','pill',`Бюджет: ${direction.spent}`));
    card.append(heading,element('p','',direction.text));$('direction-conclusions').append(card);
  });
  report.watchpoints.forEach(text=>$('watchpoint-list').append(element('li','',text)));
  if(report.resolved_critical.length){$('resolved-critical').append(element('h4','','Вышли из критической зоны'));report.resolved_critical.forEach(text=>$('resolved-critical').append(element('p','',text)));}
  if(report.synergies.length){$('synergy-conclusions').append(element('h4','','Сработали совместные эффекты'));report.synergies.forEach(item=>$('synergy-conclusions').append(element('p','',item.text)));}
  report.measures.forEach(measure=>{
    const card=element('article','measure-conclusion');
    card.append(element('p','eyebrow',`${measure.id} / ${measure.scope} / ${measure.cost} усл. ед.`),element('h4','',measure.name));
    const facts=element('div','measure-facts');facts.append(element('strong','','Эффект по датасету'));
    facts.append(element('p','',measure.effects.map(effect=>`${effect.label}: ${effect.delta>0?'+':''}${fmt(effect.delta)}`).join(' · ')));
    facts.append(element('p','timing',measure.timing));
    facts.append(element('p','effect-note','Изменение от этой меры в каждом затронутом районе, до ограничения 0–100. Бонусы сочетаний указаны отдельно.'));
    card.append(facts,element('p','mechanism',measure.mechanism));
    const support=element('div','reaction support');support.append(element('h5','','Кто может поддержать'),element('p','',measure.possible_support));
    const concerns=element('div','reaction concern');concerns.append(element('h5','','Кто может быть недоволен и почему'),element('p','',measure.possible_concerns));
    card.append(support,concerns);$('measure-conclusions').append(card);
  });
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
    renderSummary();renderMap();renderDistrict();renderMeasures();
  } catch(error) {$('load-error').hidden=false;$('load-error').textContent='Не удалось загрузить данные. Запустите python web_server.py и обновите страницу.';}
}
init();
