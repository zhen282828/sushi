"use strict";

const Persistence = (function(){
  const KEY = "sushidoNostalgiaSave_v4";
  let memoryFallback = {
    bestArcadeScore:0, bestZenScore:0, bestDailyScore:0,
    bestComboArcade:0, bestComboZen:0, soundOn:true,
    coins: 0, unlockedSkins: ['classic'], equippedSkin: 'classic',
    achievements: {}, stats: { totalOrders:0, totalCombos:0, totalPowerups:0, maxLevel:1 }
  };
  let storageOK = true;
  try{ const t="__test__"; window.localStorage.setItem(t,"1"); window.localStorage.removeItem(t); }catch(e){ storageOK=false; }

  function load(){
    if(!storageOK) return { ...memoryFallback };
    try{
      const raw = window.localStorage.getItem(KEY);
      if(!raw) return { ...memoryFallback };
      const parsed = JSON.parse(raw);
      return { ...memoryFallback, ...parsed, stats: { ...memoryFallback.stats, ...(parsed.stats||{}) } };
    }catch(e){ return { ...memoryFallback }; }
  }
  function save(data){
    memoryFallback = { ...memoryFallback, ...data };
    if(!storageOK) return;
    try{ window.localStorage.setItem(KEY, JSON.stringify(memoryFallback)); }catch(e){}
  }
  return { load, save, get:()=>memoryFallback };
})();

const AudioEngine = (function(){
  let ctx = null, enabled = true;
  function ensure(){ if(!ctx) try{ ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ ctx=null; } }
  document.addEventListener("pointerdown", function firstTouch(){ ensure(); if(ctx && ctx.state==="suspended") ctx.resume().catch(()=>{}); document.removeEventListener("pointerdown", firstTouch); }, { once:true });
  function setEnabled(v){ enabled = v; }
  
  function tone(freq, t0offset, dur, type, vol){
    if(!enabled || !ctx) return;
    try{
      const t0 = ctx.currentTime + t0offset, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type || "sine"; osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0); gain.gain.linearRampToValueAtTime(vol!=null?vol:0.15, t0+0.008); gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      osc.connect(gain).connect(ctx.destination); osc.start(t0); osc.stop(t0+dur+0.02);
    }catch(e){}
  }
  function noiseBurst(t0offset, dur, filterFreq, vol){
    if(!enabled || !ctx) return;
    try{
      const t0 = ctx.currentTime + t0offset, bufferSize = Math.floor(ctx.sampleRate * dur), buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate), data = buffer.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * (1 - i/bufferSize);
      const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
      src.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = filterFreq||1200;
      gain.gain.setValueAtTime(vol!=null?vol:0.22, t0); gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
      src.connect(filter).connect(gain).connect(ctx.destination); src.start(t0);
    }catch(e){}
  }
  return {
    ensure, setEnabled, isEnabled: ()=>enabled,
    matchPop: (tier)=> tone(760 + Math.min(tier,8)*70, 0, 0.14, "square", 0.13),
    powerupBlast: ()=> { noiseBurst(0, 0.3, 800, 0.25); tone(100, 0.02, 0.3, "sine", 0.2); },
    orderComplete: ()=> [523.25,659.25,783.99,1046.5].forEach((f,i)=> tone(f, i*0.09, 0.22, "triangle", 0.15)),
    levelUp: ()=> [440,554,659,880].forEach((f,i)=> tone(f, i*0.07, 0.18, "square", 0.12)),
    gameOver: ()=> [392,330,262].forEach((f,i)=> tone(f, i*0.18, 0.3, "sine", 0.15)),
    invalidSwap: ()=> tone(160, 0, 0.12, "square", 0.08),
    achievement: ()=> [600, 800, 1200].forEach((f,i)=> tone(f, i*0.1, 0.3, "sine", 0.1))
  };
})();

const MetaSystem = (function(){
  const SKINS = [
    { id: 'classic', name: 'Classic Wood', cost: 0, icon: '🪵', desc: 'The nostalgic sushi bar.' },
    { id: 'sakura', name: 'Sakura Petal', cost: 15, icon: '🌸', desc: 'Pink cherry blossom vibes.' },
    { id: 'matcha', name: 'Matcha Tea', cost: 25, icon: '🍵', desc: 'Calming green aesthetic.' },
    { id: 'neon', name: 'Cyber Neon', cost: 50, icon: '🌃', desc: 'Late night Tokyo drift.' }
  ];
  const ACHIEVEMENTS = [
    { id: 'first_shift', name: 'First Shift', icon: '🔰', desc: 'Complete 1 order.', check: (s) => s.stats.totalOrders >= 1 },
    { id: 'sushi_master', name: 'Sushi Master', icon: '🍣', desc: 'Reach Level 10.', check: (s) => s.stats.maxLevel >= 10 },
    { id: 'cascade_king', name: 'Cascade King', icon: '🌊', desc: 'Reach a Combo x7.', check: (s) => s.stats.totalCombos >= 7 },
    { id: 'boom', name: 'Explosive Taste', icon: '💥', desc: 'Trigger 50 Powerups.', check: (s) => s.stats.totalPowerups >= 50 },
    { id: 'collector', name: 'Decorator', icon: '🎨', desc: 'Unlock a new skin.', check: (s) => s.unlockedSkins.length > 1 }
  ];

  function showToast(icon, title, subtitle) {
    const cont = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span style="font-size:28px">${icon}</span><div><div style="font-size:11px;opacity:0.8">${subtitle}</div><div style="font-size:14px">${title}</div></div>`;
    cont.appendChild(t);
    setTimeout(() => t.remove(), 4000);
    AudioEngine.achievement();
  }

  function checkAchievements() {
    const save = Persistence.get();
    let updated = false;
    ACHIEVEMENTS.forEach(ach => {
      if (!save.achievements[ach.id] && ach.check(save)) {
        save.achievements[ach.id] = true;
        updated = true;
        showToast(ach.icon, ach.name, "Achievement Unlocked!");
      }
    });
    if(updated) Persistence.save(save);
    updateMetaUI();
  }

  function applySkin(id) {
    document.body.className = id === 'classic' ? '' : `skin-${id}`;
  }

  function updateMetaUI() {
    const save = Persistence.get();
    const metaCoinsEl = document.getElementById('metaCoins');
    if(metaCoinsEl) metaCoinsEl.textContent = save.coins;
    const unlockedCount = Object.keys(save.achievements).length;
    const metaTrophiesEl = document.getElementById('metaTrophies');
    if(metaTrophiesEl) metaTrophiesEl.textContent = `${unlockedCount}/${ACHIEVEMENTS.length}`;
    
    const achList = document.getElementById('achievementsList');
    if(achList) {
      achList.innerHTML = ACHIEVEMENTS.map(ach => `
        <div class="list-item ${save.achievements[ach.id] ? '' : 'locked'}">
          <div class="item-icon">${ach.icon}</div>
          <div class="item-details"><h4>${ach.name}</h4><p>${ach.desc}</p></div>
        </div>
      `).join('');
    }

    const skinsList = document.getElementById('skinsList');
    if(skinsList) {
      skinsList.innerHTML = SKINS.map(s => {
        const isUnlocked = save.unlockedSkins.includes(s.id);
        const isEquipped = save.equippedSkin === s.id;
        return `
          <div class="list-item ${isEquipped ? 'active' : ''}">
            <div class="item-icon">${s.icon}</div>
            <div class="item-details" style="flex:1"><h4>${s.name}</h4><p>${s.desc}</p></div>
            <div>
              ${isEquipped ? '<b>Equipped</b>' : 
                isUnlocked ? `<button class="btn small" onclick="MetaSystem.equipSkin('${s.id}')">Equip</button>` :
                `<button class="btn small secondary" onclick="MetaSystem.buySkin('${s.id}', ${s.cost})" ${save.coins >= s.cost ? '' : 'disabled'}>🪙 ${s.cost}</button>`
              }
            </div>
          </div>
        `;
      }).join('');
    }
  }

  return { 
    checkAchievements, updateMetaUI, applySkin, 
    equipSkin: (id) => { const s = Persistence.get(); s.equippedSkin = id; Persistence.save(s); applySkin(id); updateMetaUI(); },
    buySkin: (id, cost) => { 
      const s = Persistence.get(); 
      if(s.coins >= cost) { 
        s.coins -= cost; if(!s.unlockedSkins.includes(id)) s.unlockedSkins.push(id); s.equippedSkin = id; 
        Persistence.save(s); applySkin(id); updateMetaUI(); checkAchievements();
      } 
    }
  };
})();

const SIZE = 8;
const BASE_TYPES = ["sushi","shrimp","rice","avocado","fish"];
const EMOJI = { sushi:"🍣", shrimp:"🍤", rice:"🍙", avocado:"🥑", fish:"🐟", dumpling:"🥟", tea:"🍵", wasabi:"🟢", soy:"🧴", rocket:"🥢", tempura:"💥", rainbow:"🌈" };
const LABEL = { sushi:"Sushi", shrimp:"Shrimp", rice:"Rice", avocado:"Avocado", fish:"Fish", dumpling:"Dumpling", tea:"Tea", wasabi:"Wasabi", soy:"Soy Splash", rocket:"Rocket", tempura:"Tempura Bomb", rainbow:"Rainbow" };

// Central tuning knobs. Anything that shapes game feel/balance lives here instead of
// being scattered as inline literals through GameController/OrderSystem, so pacing
// can be tuned in one place without hunting through the logic.
const CONFIG = {
  patience: {
    start: 100,
    decayPerSecBase: 1.8,
    decayPerSecMax: 5.0,
    decayGrowthPerLevel: 0.35,
    regainPerOrderBase: 35,
    lowWarnThreshold: 50,
    criticalThreshold: 25,
    reactAngryThreshold: 15,
    reactMadThreshold: 35,
    reactWorriedThreshold: 60
  },
  daily: {
    durationSec: 180
  },
  speedOrder: {
    timeLimitSec: 35,
    need: 4
  },
  idle: {
    hintAfterSec: 5.0
  },
  scoring: {
    orderBonusBase: 750,
    orderBonusPerLevel: 250,
    clearPointsPerTile: 100,
    coinsPerPointArcade: 400, // divisor: score / this = coins earned (arcade & daily)
    coinsPerPointZen: 800     // zen scores run higher, so it converts at a steeper rate
  },
  combo: {
    rocketTier: 3,
    tempuraTier: 5,
    rainbowTier: 7,
    legendaryTier: 10
  },
  leveling: {
    ordersPerLevelBase: 3 // level-up every (3 + floor(level/2)) orders completed
  },
  animation: {
    swapMs: 180,
    clearWaitMs: 280,
    gravityMs: 220,
    postGravityWaitMs: 240,
    invalidSwapWaitMs: 300
  }
};

class BoardEngine {
  constructor(){ this.cells = []; this.idCounter = 1; this.activeTypes = [...BASE_TYPES]; }
  
  updateActiveTypes(level) {
    this.activeTypes = [...BASE_TYPES];
    if(level >= 4) this.activeTypes.push("dumpling");
    if(level >= 8) this.activeTypes.push("tea");
  }

  newTile(type){ return { type, id: this.idCounter++ }; }
  isStandard(type){ return this.activeTypes.includes(type); }
  inBounds(r,c){ return r>=0 && r<SIZE && c>=0 && c<SIZE; }
  get(r,c){ return this.cells[r][c]; }
  set(r,c,tile){ this.cells[r][c] = tile; }
  isPowerUp(r, c) { const t = this.get(r, c); return t && !this.isStandard(t.type); }

  generateInitialBoard(){
    let attempt = 0;
    do{
      this.cells = Array.from({length:SIZE}, () => Array(SIZE).fill(null));
      for(let r=0;r<SIZE;r++){
        for(let c=0;c<SIZE;c++){
          let t, tries = 0;
          do{
            t = this.activeTypes[Math.floor(Math.random()*this.activeTypes.length)];
            tries++;
          } while(this._wouldMatch(this.cells, r, c, t) && tries < 30);
          this.cells[r][c] = this.newTile(t);
        }
      }
      attempt++;
    } while(!this.getValidMove() && attempt < 60);
  }

  _wouldMatch(grid, r, c, t){
    if(c>=2 && grid[r][c-1] && grid[r][c-2] && grid[r][c-1].type===t && grid[r][c-2].type===t) return true;
    if(r>=2 && grid[r-1][c] && grid[r-2][c] && grid[r-1][c].type===t && grid[r-2][c].type===t) return true;
    return false;
  }

  swap(r1,c1,r2,c2){ const tmp = this.cells[r1][c1]; this.cells[r1][c1] = this.cells[r2][c2]; this.cells[r2][c2] = tmp; }

  findLines(cellsGrid){
    const grid = cellsGrid || this.cells;
    const lines = [];
    for(let r=0;r<SIZE;r++){
      let c=0;
      while(c<SIZE){
        const t = grid[r][c] ? grid[r][c].type : null;
        if(t && this.isStandard(t)){
          let c2=c; while(c2+1<SIZE && grid[r][c2+1] && grid[r][c2+1].type===t) c2++;
          if(c2-c+1 >= 3) lines.push({cells: Array.from({length:c2-c+1}, (_,i)=>({r, c:c+i})), type:t, length:c2-c+1});
          c = c2+1;
        } else c++;
      }
    }
    for(let c=0;c<SIZE;c++){
      let r=0;
      while(r<SIZE){
        const t = grid[r][c] ? grid[r][c].type : null;
        if(t && this.isStandard(t)){
          let r2=r; while(r2+1<SIZE && grid[r2+1][c] && grid[r2+1][c].type===t) r2++;
          if(r2-r+1 >= 3) lines.push({cells: Array.from({length:r2-r+1}, (_,i)=>({r:r+i, c})), type:t, length:r2-r+1});
          r = r2+1;
        } else r++;
      }
    }
    return lines;
  }

  getValidMove(){
    for(let r=0;r<SIZE;r++){
      for(let c=0;c<SIZE;c++){
        if(c+1<SIZE) {
          if (this.isPowerUp(r,c) || this.isPowerUp(r,c+1)) return [{r,c}, {r,c:c+1}];
          this.swap(r,c,r,c+1); if(this.findLines().length > 0){ this.swap(r,c,r,c+1); return [{r,c}, {r,c:c+1}]; } this.swap(r,c,r,c+1);
        }
        if(r+1<SIZE) {
          if (this.isPowerUp(r,c) || this.isPowerUp(r+1,c)) return [{r,c}, {r:r+1,c}];
          this.swap(r,c,r+1,c); if(this.findLines().length > 0){ this.swap(r,c,r+1,c); return [{r,c}, {r:r+1,c}]; } this.swap(r,c,r+1,c);
        }
      }
    }
    return null;
  }

  applyGravityAndRefill(){
    const spawned = []; 
    for(let c=0;c<SIZE;c++){
      let writeR = SIZE-1;
      for(let r=SIZE-1;r>=0;r--){
        if(this.cells[r][c]){
          this.cells[writeR][c] = this.cells[r][c];
          if(writeR!==r) this.cells[r][c] = null;
          writeR--;
        }
      }
      for(let r=writeR;r>=0;r--){
        const tile = this.newTile(this.activeTypes[Math.floor(Math.random()*this.activeTypes.length)]);
        this.cells[r][c] = tile;
        spawned.push({r,c,tile});
      }
    }
    return spawned;
  }
}

const FLIP = {
  positions: new Map(),
  record(container) {
    this.positions.clear();
    for (const child of container.children) if (child.dataset.id) this.positions.set(child.dataset.id, child.getBoundingClientRect());
  },
  play(container, duration = 200) {
    const active = [];
    for (const child of container.children) {
      const id = child.dataset.id;
      if (id && this.positions.has(id)) {
        const oldPos = this.positions.get(id), newPos = child.getBoundingClientRect();
        const dx = oldPos.left - newPos.left, dy = oldPos.top - newPos.top;
        if (dx !== 0 || dy !== 0) { child.style.transition = 'none'; child.style.transform = `translate(${dx}px, ${dy}px)`; active.push(child); }
      }
    }
    if(active.length === 0) return Promise.resolve();
    container.offsetHeight;
    for (const child of active) { child.style.transition = `transform ${duration}ms ease`; child.style.transform = 'translate(0, 0)'; }
    return new Promise(resolve => setTimeout(resolve, duration));
  }
};

const CustomerSystem = (function(){
  const ARCHETYPES = [
    { id: 'apprentice', name: 'Apprentice Chef', emoji: '🧑‍🍳', desc: 'Patient beginner with simple tastes.', diff: '⭐', patienceMod: 1.5, countMod: 0.8, ptsMod: 0.9, minLevel: 1, weight: 30 },
    { id: 'regular', name: 'Regular Ryu', emoji: '👨', desc: 'Loyal customer looking for standard fare.', diff: '⭐⭐', patienceMod: 1.0, countMod: 1.0, ptsMod: 1.0, minLevel: 1, weight: 25 },
    { id: 'child', name: 'Little Kenji', emoji: '👦', desc: 'Smaller orders, loves sweet treats.', diff: '⭐', patienceMod: 1.3, countMod: 0.7, ptsMod: 0.8, minLevel: 1, weight: 20 },
    { id: 'tourist', name: 'Snapshot Sarah', emoji: '📸', desc: 'Wants colorful mixed platters.', diff: '⭐⭐', patienceMod: 1.1, countMod: 1.2, ptsMod: 1.2, minLevel: 2, weight: 15 },
    { id: 'salaryman', name: 'Tired Salaryman', emoji: '🧑‍💼', desc: 'Patience drains fast, high tips.', diff: '⭐⭐⭐', patienceMod: 0.6, countMod: 1.1, ptsMod: 1.4, minLevel: 2, weight: 15 },
    { id: 'healthnut', name: 'Health Nut Hana', emoji: '🥗', desc: 'Prefers greens and lighter dishes.', diff: '⭐⭐⭐', patienceMod: 0.9, countMod: 1.3, ptsMod: 1.3, minLevel: 3, weight: 12 },
    { id: 'critic', name: 'Food Critic Ken', emoji: '🧐', desc: 'Demands combo mastery for high praise.', diff: '⭐⭐⭐⭐', patienceMod: 0.8, countMod: 1.4, ptsMod: 1.8, minLevel: 4, weight: 10 },
    { id: 'teen', name: 'Impulsive Yuto', emoji: '🧑', desc: 'Impatient and unpredictable orders.', diff: '⭐⭐⭐', patienceMod: 0.7, countMod: 1.2, ptsMod: 1.5, minLevel: 4, weight: 10 },
    { id: 'master', name: 'Sushi Master Shifu', emoji: '🥋', desc: 'Strict standards requiring power-ups.', diff: '⭐⭐⭐⭐⭐', patienceMod: 0.5, countMod: 1.5, ptsMod: 2.2, minLevel: 6, weight: 6 },
    { id: 'vip', name: 'VIP Ambassador', emoji: '🤵', desc: 'Massive multi-objective luxury orders.', diff: '⭐⭐⭐⭐⭐', patienceMod: 0.6, countMod: 1.8, ptsMod: 2.5, minLevel: 7, weight: 4 }
  ];

  let activeCustomer = null;
  let lastCustomerId = null;
  let lastFace = "";

  const el = (id)=>document.getElementById(id);

  function selectCustomer(level) {
    const available = ARCHETYPES.filter(c => level >= c.minLevel && c.id !== lastCustomerId);
    if (!available.length) available.push(...ARCHETYPES.filter(c => level >= c.minLevel));
    const totalWeight = available.reduce((sum, c) => sum + c.weight, 0);
    let rnd = Math.random() * totalWeight;
    let chosen = available[0];
    for(const c of available) {
      if(rnd < c.weight) { chosen = c; break; }
      rnd -= c.weight;
    }
    lastCustomerId = chosen.id;
    activeCustomer = chosen;

    el("customerName").textContent = activeCustomer.name;
    const descEl = el("customerDesc"); if(descEl) descEl.textContent = activeCustomer.desc;
    el("customerDiff").textContent = activeCustomer.diff;
    el("customerBonus").textContent = `Tip +${Math.round((activeCustomer.ptsMod - 1)*100)}%`;
    setFace(activeCustomer.emoji);
    return activeCustomer;
  }

  function setFace(f) {
    if(lastFace !== f) {
      const faceEl = el("customerFace");
      faceEl.textContent = f;
      faceEl.classList.remove("bounce");
      void faceEl.offsetWidth;
      faceEl.classList.add("bounce");
      lastFace = f;
    }
  }

  function react(eventType, patience, mode, shakeCallback) {
    if (mode === "zen" || mode === "daily") return;
    if (el("customerFace").textContent === "😍") return;
    
    const faceEl = el("customerFace");
    if (eventType === 'bigCombo') {
      setFace("🤩");
      setTimeout(() => { if(activeCustomer) setFace(activeCustomer.emoji); }, 1200);
    } else if (eventType === 'mistake') {
      setFace("😔");
      setTimeout(() => { if(activeCustomer) setFace(activeCustomer.emoji); }, 1000);
    } else if (eventType === 'powerup') {
      setFace("😆");
      setTimeout(() => { if(activeCustomer) setFace(activeCustomer.emoji); }, 1000);
    } else {
      if (patience <= CONFIG.patience.reactAngryThreshold) { setFace("🤬"); if(shakeCallback) shakeCallback(0.3); }
      else if (patience <= CONFIG.patience.reactMadThreshold) { setFace("😠"); if(shakeCallback) shakeCallback(0.2); }
      else if (patience <= CONFIG.patience.reactWorriedThreshold) setFace("😟"); 
      else if (activeCustomer) setFace(activeCustomer.emoji);
    }
  }

  return { selectCustomer, setFace, react, getActive: () => activeCustomer };
})();

const OrderSystem = (function(){
  let currentOrder = null;
  let lastOrderTypes = [];

  const el = (id)=>document.getElementById(id);

  function pickOrderType(boardActiveTypes){
    let candidate, guard=0;
    do{ candidate = boardActiveTypes[Math.floor(Math.random()*boardActiveTypes.length)]; guard++; } 
    while(lastOrderTypes.length>=2 && lastOrderTypes[0]===candidate && lastOrderTypes[1]===candidate && guard<20);
    lastOrderTypes.push(candidate); if(lastOrderTypes.length>2) lastOrderTypes.shift();
    return candidate;
  }

  function generateOrder(level, customer, boardActiveTypes, mode=null){
    const categories = ['basic'];
    if(level >= 3) categories.push('mixed');
    if(level >= 5) categories.push('combo');
    if(level >= 7) categories.push('powerup');
    if(level >= 8) categories.push('speed');
    if(level >= 9) categories.push('vip');

    let cat = categories[Math.floor(Math.random() * categories.length)];
    if(customer.id === 'critic') cat = Math.random() < 0.7 ? 'combo' : (Math.random() < 0.9 ? 'mixed' : 'basic');
    if(customer.id === 'healthnut') cat = 'basic';
    if(customer.id === 'tourist') cat = 'mixed';
    if(customer.id === 'master') cat = 'powerup';
    if(customer.id === 'vip') cat = 'vip';
    if(mode === 'daily' && cat === 'speed') cat = 'basic';

    const growth = Math.min(level-1, 6);

    if(cat === 'basic') {
      let type = pickOrderType(boardActiveTypes);
      if(customer.id === 'healthnut' && boardActiveTypes.includes('avocado')) type = 'avocado';
      let need = Math.max(2, Math.floor((4 + Math.floor(Math.random()*3) + growth) * customer.countMod));
      currentOrder = { category: 'basic', type, need, have:0, desc: `Wants ${need} ${EMOJI[type]}` };
    } 
    else if(cat === 'mixed') {
      const t1 = pickOrderType(boardActiveTypes);
      let t2; do{ t2 = pickOrderType(boardActiveTypes); } while(t2 === t1);
      const need1 = Math.max(2, Math.floor((3 + Math.floor(Math.random()*2)) * customer.countMod));
      const need2 = Math.max(2, Math.floor((3 + Math.floor(Math.random()*2)) * customer.countMod));
      currentOrder = { category: 'mixed', type: t1, secondaryType: t2, need: need1, secondaryNeed: need2, have: 0, secondaryHave: 0, desc: `${need1} ${EMOJI[t1]} & ${need2} ${EMOJI[t2]}` };
    }
    else if(cat === 'combo') {
      const targetCombo = Math.min(6, 3 + Math.floor(Math.random() * 2));
      currentOrder = { category: 'combo', targetCombo, have: 0, need: targetCombo, desc: `Reach Combo ×${targetCombo}` };
    }
    else if(cat === 'powerup') {
      const pTypes = ['wasabi', 'soy', 'rocket'];
      const pt = pTypes[Math.floor(Math.random() * pTypes.length)];
      const count = 1 + (level > 6 ? 1 : 0);
      currentOrder = { category: 'powerup', powerupType: pt, need: count, have: 0, desc: `Trigger ${count} ${EMOJI[pt] || '⚡'} Powerup${count>1?'s':''}` };
    }
    else if(cat === 'speed') {
      const type = pickOrderType(boardActiveTypes);
      const need = 4;
      currentOrder = { category: 'speed', type, need, have: 0, timeLeft: CONFIG.speedOrder.timeLimitSec, desc: `Fast! ${need} ${EMOJI[type]} in ${CONFIG.speedOrder.timeLimitSec}s` };
    }
    else {
      const t1 = pickOrderType(boardActiveTypes);
      const need1 = 4;
      currentOrder = { category: 'vip', type: t1, need: need1, have: 0, targetCombo: 4, comboAchieved: false, desc: `VIP: ${need1} ${EMOJI[t1]} + Combo ×4` };
    }

    el("customerOrderText").textContent = currentOrder.desc;
    el("customerProgressText").textContent = currentOrder.category === 'mixed' ? `0/${currentOrder.need} | 0/${currentOrder.secondaryNeed}` : `0 / ${currentOrder.need}`;
    return currentOrder;
  }

  return { generateOrder, getOrder: () => currentOrder };
})();

const ProgressionSystem = (function(){
  let level = 1;
  let ordersDone = 0;

  function reset() {
    level = 1;
    ordersDone = 0;
  }

  function registerOrderCompletion(mode) {
    ordersDone++;
    const save = Persistence.get();
    save.stats.totalOrders++;
    Persistence.save(save);

    let leveledUp = false;
    if (ordersDone > 0 && ordersDone % (CONFIG.leveling.ordersPerLevelBase + Math.floor(level/2)) === 0) {
      level++;
      save.stats.maxLevel = Math.max(save.stats.maxLevel, level);
      Persistence.save(save);
      leveledUp = true;
    }
    return { level, ordersDone, leveledUp };
  }

  return { reset, registerOrderCompletion, getLevel: () => level, getOrdersDone: () => ordersDone };
})();

// Lightweight state machine for the overall game screen. This doesn't replace the
// fine-grained `locked` flag (which guards mid-animation input during a single
// resolve step) — it answers the coarser question "is a run currently playable?",
// which used to be checked ad hoc via `locked || !mode` in half a dozen places.
const Phase = Object.freeze({
  TITLE: "title",       // on the title screen, no active run
  PLAYING: "playing",   // a run is active and accepting input (modulo `locked`)
  GAMEOVER: "gameover"  // run just ended, game-over overlay is showing
});

const GameController = (function(){
  const board = new BoardEngine();
  let mode = null;
  let phase = Phase.TITLE;
  let score = 0, bestComboRun = 0, coinsEarned = 0;
  let totalPowerupsThisRun = 0, maxCascadeTierThisRun = 0;
  let locked = false, selected = null, patience = CONFIG.patience.start, patienceDecayPerSec = CONFIG.patience.decayPerSecBase;
  let lastFrameTime = null, paused = true, activeSessionToken = 0, idleTime = 0, dailyTimeLeft = CONFIG.daily.durationSec;
  
  let keyboardFocus = {r: 3, c: 3};
  const el = (id)=>document.getElementById(id);
  const boardEl = el("board"), floatLayer = el("floatLayer"), boardShell = el("boardShell");

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
  function announce(msg){ el("liveRegion").textContent = ""; setTimeout(() => el("liveRegion").textContent = msg, 50); }

  // Single source of truth for "can the player currently interact with the board".
  // Replaces the repeated `locked || !mode` checks that were previously duplicated
  // across the pointer, keyboard, and swap-submission handlers.
  function canInteract(){ return phase === Phase.PLAYING && !locked; }

  function init() {
    MetaSystem.applySkin(Persistence.get().equippedSkin);
    MetaSystem.updateMetaUI();
  }

  function nextCustomerAndOrder() {
    CustomerSystem.selectCustomer(ProgressionSystem.getLevel());
    OrderSystem.generateOrder(ProgressionSystem.getLevel(), CustomerSystem.getActive(), board.activeTypes, mode);
  }

  function completeOrder(){
    const prog = ProgressionSystem.registerOrderCompletion(mode);
    el("ordersLabel").textContent = prog.ordersDone;
    
    CustomerSystem.setFace("😍");
    const ticketBox = el("customerTicketBox");
    ticketBox.classList.add("celebrate");
    setTimeout(() => { 
      ticketBox.classList.remove("celebrate");
      const c = CustomerSystem.getActive(); 
      if(c) CustomerSystem.setFace(c.emoji); 
    }, 1500);

    const activeCust = CustomerSystem.getActive();
    const bonus = Math.floor((CONFIG.scoring.orderBonusBase + prog.level * CONFIG.scoring.orderBonusPerLevel) * activeCust.ptsMod);
    addScore(bonus); AudioEngine.orderComplete(); showFloatText(`+${bonus} 🎉`, 4, 4, 3);
    
    if(mode==="arcade"){
      patience = Math.min(CONFIG.patience.start, patience + (CONFIG.patience.regainPerOrderBase / activeCust.patienceMod));
      updatePatienceUI();
    }
    
    if(prog.leveledUp){
      board.updateActiveTypes(prog.level);
      if(mode==="arcade") patienceDecayPerSec = Math.min(CONFIG.patience.decayPerSecMax, CONFIG.patience.decayPerSecBase + (prog.level-1)*CONFIG.patience.decayGrowthPerLevel);
      const b = document.createElement("div"); b.className = "banner"; b.textContent = "⭐ Level Up! Lv." + prog.level + " ⭐";
      boardShell.appendChild(b); setTimeout(()=> b.remove(), 1800); AudioEngine.levelUp();
    }
    el("levelLabel").textContent = prog.level;
    
    nextCustomerAndOrder();
  }

  function shakeBoard(intensity){ if(intensity<=0) return; boardShell.classList.remove("board-shake"); void boardShell.offsetWidth; boardShell.classList.add("board-shake"); }
  
  function showFloatText(text, r, c, tier=1){
    const sz = boardEl.clientWidth / SIZE, x = (c+0.5)*sz, y = (r+0.5)*sz;
    const t = document.createElement("div"); t.className = "float-text"; t.textContent = text;
    
    if (tier >= CONFIG.combo.rainbowTier || text.includes('INSANE')) {
      t.style.fontSize = "26px";
      t.style.color = "var(--neon-pink)";
      t.style.textShadow = "0 0 8px var(--neon-gold), 0 0 16px var(--neon-pink), 0 2px 0 #5c2e0e";
    } else if (tier >= CONFIG.combo.tempuraTier) {
      t.style.fontSize = "22px";
      t.style.color = "var(--neon-cyan)";
      t.style.textShadow = "0 0 6px var(--neon-cyan), 0 2px 0 #3a2410";
    } else if (tier >= CONFIG.combo.rocketTier) {
      t.style.fontSize = "19px";
      t.style.color = "var(--neon-gold)";
    } else {
      t.style.fontSize = "16px";
      t.style.color = "#ffd23f";
    }

    t.style.left = x + "px"; t.style.top = y + "px"; t.style.transform = "translate(-50%,-50%)";
    floatLayer.appendChild(t); setTimeout(()=> t.remove(), 1100);
  }

  function addScore(points){ score += points; el("scoreLabel").textContent = score; }
  
  function updateComboUI(tier){
    const maxComboDisplay = Math.max(bestComboRun, tier);
    el("comboLabel").textContent = "×" + maxComboDisplay;
    
    const fillEl = el("comboEnergyFill");
    const nextEl = el("comboEnergyNext");
    const titleEl = el("comboEnergyTitle");
    const containerEl = el("comboEnergyContainer");
    
    if (tier >= CONFIG.combo.rocketTier) {
      containerEl.classList.add("juicy");
      setTimeout(() => containerEl.classList.remove("juicy"), 300);
    }

    let pct = 0;
    if (tier <= 1) {
      pct = 0;
      if(nextEl) nextEl.textContent = "NEXT: 🥢 Rocket (×3)";
      if(titleEl) titleEl.textContent = "COMBO ENERGY";
    } else if (tier === 2) {
      pct = 33;
      if(nextEl) nextEl.textContent = "NEXT: 🥢 Rocket (×3)";
      if(titleEl) titleEl.textContent = "COMBO ENERGY";
    } else if (tier === 3 || tier === 4) {
      pct = 66;
      if(nextEl) nextEl.textContent = "NEXT: 💥 Tempura (×5)";
      if(titleEl) titleEl.textContent = "COMBO ENERGY";
    } else if (tier >= CONFIG.combo.tempuraTier && tier < CONFIG.combo.rainbowTier) {
      pct = 90;
      if(nextEl) nextEl.textContent = "NEXT: 🌈 Rainbow (×7)";
      if(titleEl) titleEl.textContent = "COMBO ENERGY";
    } else if (tier >= CONFIG.combo.rainbowTier) {
      pct = 100;
      if(nextEl) nextEl.textContent = "⚡ READY!";
      if(titleEl) titleEl.textContent = "⚡ COMBO DROP READY";
    }
    if(fillEl) fillEl.style.width = pct + "%";
  }

  function updatePatienceUI(){
    const fill = el("patienceFill");
    if (mode === "daily") {
      const pct = Math.max(0, (dailyTimeLeft / CONFIG.daily.durationSec) * 100);
      fill.style.width = pct + "%";
      fill.style.background = pct > 20 ? "linear-gradient(90deg,#37c76b,#8fe673)" : "linear-gradient(90deg,#c0392b,#e57368)";
      el("patienceLabel").textContent = Math.ceil(dailyTimeLeft) + "s";
      return;
    }
    fill.style.width = Math.max(0, patience) + "%";
    let color = "linear-gradient(90deg,#37c76b,#8fe673)";
    if(patience<=CONFIG.patience.lowWarnThreshold) color = "linear-gradient(90deg,#e0a52c,#f4cf6a)";
    if(patience<=CONFIG.patience.criticalThreshold) color = "linear-gradient(90deg,#c0392b,#e57368)";
    fill.style.background = color;
    el("patienceLabel").textContent = Math.max(0, Math.round(patience)) + "%";
  }

  function tickGameLoop(ts){
    if(paused) { lastFrameTime = null; return; }
    if(lastFrameTime==null) lastFrameTime = ts;
    const dt = (ts-lastFrameTime)/1000; lastFrameTime = ts;
    
    idleTime += dt;
    if(idleTime > CONFIG.idle.hintAfterSec && !locked) {
      idleTime = 0;
      const move = board.getValidMove();
      if(move) {
        getTileEl(move[0].r, move[0].c)?.classList.add("hint-pulse");
        getTileEl(move[1].r, move[1].c)?.classList.add("hint-pulse");
      }
    }

    if(mode==="arcade"){
      const activeCust = CustomerSystem.getActive();
      patience -= (patienceDecayPerSec * activeCust.patienceMod) * dt;
      const currentOrd = OrderSystem.getOrder();
      if(currentOrd && currentOrd.category === 'speed') {
        currentOrd.timeLeft -= dt;
        if(currentOrd.timeLeft <= 0) { patience = 0; }
      }
      if(patience<=0){ patience=0; updatePatienceUI(); CustomerSystem.react('fail', patience, mode, shakeBoard); endRun(true); return; }
      updatePatienceUI(); CustomerSystem.react('tick', patience, mode, shakeBoard);
    } else if(mode==="daily"){
      dailyTimeLeft -= dt;
      if(dailyTimeLeft<=0){ dailyTimeLeft=0; updatePatienceUI(); endRun(true); return; }
      updatePatienceUI();
    }
    requestAnimationFrame(tickGameLoop);
  }

  function renderBoardState() {
    for(let r=0; r<SIZE; r++) {
      for(let c=0; c<SIZE; c++) {
        const t = board.get(r,c); if(!t) continue;
        let tileEl = document.getElementById("tile-"+t.id);
        if(!tileEl) {
          tileEl = document.createElement("div"); tileEl.id = "tile-"+t.id; tileEl.className = "tile pop-in"; tileEl.dataset.id = t.id;
          boardEl.appendChild(tileEl);
        }
        tileEl.style.gridArea = `${r+1} / ${c+1}`; tileEl.dataset.r = r; tileEl.dataset.c = c;
        tileEl.tabIndex = (r === keyboardFocus.r && c === keyboardFocus.c) ? 0 : -1;
        
        let classes = "tile";
        if(!board.isStandard(t.type)) classes += " special-" + t.type;
        if(selected && selected.r === r && selected.c === c) classes += " selected";
        if(tileEl.classList.contains("clearing")) classes += " clearing";
        if(tileEl.classList.contains("hint-pulse")) classes += " hint-pulse";
        
        tileEl.className = classes; tileEl.textContent = EMOJI[t.type]; tileEl.setAttribute("aria-label", LABEL[t.type]);
      }
    }
  }
  function getTileEl(r, c) { const t = board.get(r, c); return t ? document.getElementById("tile-"+t.id) : null; }
  function clearHints() { document.querySelectorAll('.hint-pulse').forEach(e => e.classList.remove('hint-pulse')); idleTime = 0; }

  async function submitSwap(r1, c1, r2, c2) {
    if (!canInteract()) return;
    clearHints(); locked = true; selected = null; el("btnQuitSave").disabled = true;
    const token = activeSessionToken;
    
    FLIP.record(boardEl); board.swap(r1, c1, r2, c2); renderBoardState();
    await FLIP.play(boardEl, CONFIG.animation.swapMs); if (token !== activeSessionToken) return;
    
    const lines = board.findLines();
    const createsMatch = lines.length > 0;
    const isDirectPowerSwap = board.isPowerUp(r1, c1) && board.isPowerUp(r2, c2);
    const hasOnePowerup = board.isPowerUp(r1,c1) || board.isPowerUp(r2,c2);
    
    if (!createsMatch && !isDirectPowerSwap && !hasOnePowerup) {
      AudioEngine.invalidSwap();
      CustomerSystem.react('mistake', patience, mode);
      const e1 = getTileEl(r1, c1), e2 = getTileEl(r2, c2);
      if(e1) e1.classList.add("shake-invalid"); if(e2) e2.classList.add("shake-invalid");
      await wait(CONFIG.animation.invalidSwapWaitMs); if (token !== activeSessionToken) return;
      if(e1) e1.classList.remove("shake-invalid"); if(e2) e2.classList.remove("shake-invalid");
      
      FLIP.record(boardEl); board.swap(r1, c1, r2, c2); renderBoardState(); await FLIP.play(boardEl, CONFIG.animation.swapMs);
      locked = false; el("btnQuitSave").disabled = false; return;
    }
    await resolveBoard(token, 1, {r1, c1, r2, c2});
  }

  async function resolveBoard(token, tier, swapAction = null) {
    if (token !== activeSessionToken) return;
    updateComboUI(tier);
    maxCascadeTierThisRun = Math.max(maxCascadeTierThisRun, tier);
    const save = Persistence.get();
    
    const lines = board.findLines();
    let directTriggers = [];
    let powerComboArea = [];
    
    if (swapAction && tier === 1) {
      const {r1, c1, r2, c2} = swapAction;
      const t1 = board.get(r1,c1), t2 = board.get(r2,c2);
      if (t1 && t2 && board.isPowerUp(r1, c1) && board.isPowerUp(r2, c2)) {
        const combined = [t1.type, t2.type].sort().join('+');
        let clears = [];
        if (combined === 'rainbow+rainbow') {
          for(let rr=0; rr<SIZE; rr++) for(let cc=0; cc<SIZE; cc++) clears.push({r:rr,c:cc});
          directTriggers.push({r:r1,c:c1}, {r:r2,c:c2});
        } else if(combined.includes('rainbow')) {
          const counts = {}; board.cells.flat().forEach(c => { if(c && board.isStandard(c.type)) counts[c.type] = (counts[c.type]||0)+1; });
          const target = Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
          if(target) board.cells.flat().forEach(c => { if(c && c.type===target) clears.push({r: board.cells.findIndex(row=>row.includes(c)), c: board.cells.find(row=>row.includes(c)).indexOf(c)}); });
          directTriggers.push({r:r1,c:c1}, {r:r2,c:c2});
        } else if (combined === 'soy+soy' || combined === 'rocket+soy') {
           for(let i=0;i<SIZE;i++){ clears.push({r:r1,c:i}, {r:r2,c:i}, {r:i,c:c1}, {r:i,c:c2}); }
        } else if (combined === 'wasabi+wasabi' || combined === 'tempura+wasabi') {
           for(let dr=-2;dr<=2;dr++) for(let dc=-2;dc<=2;dc++) clears.push({r:r1+dr, c:c1+dc});
        } else {
           for(let i=0;i<SIZE;i++){ clears.push({r:r1,c:i}, {r:i,c:c1}); }
           for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) clears.push({r:r1+dr, c:c1+dc});
        }
        powerComboArea = clears.filter(pos => board.inBounds(pos.r, pos.c));
        directTriggers.push({r:r1,c:c1}, {r:r2,c:c2});
      } else {
        if (board.isPowerUp(r1, c1)) directTriggers.push({r: r1, c: c1});
        if (board.isPowerUp(r2, c2)) directTriggers.push({r: r2, c: c2});
      }
    }
    
    if (lines.length === 0 && directTriggers.length === 0 && powerComboArea.length === 0) {
      if(tier > bestComboRun) {
        bestComboRun = tier - 1;
        save.stats.totalCombos = Math.max(save.stats.totalCombos, bestComboRun); Persistence.save(save);
      }
      setTimeout(()=>updateComboUI(0), 1000); MetaSystem.checkAchievements();
      
      if (!board.getValidMove()) {
        announce("No valid moves. Shuffling board.");
        await wait(600); if (token !== activeSessionToken) return;
        board.generateInitialBoard(); renderBoardState();
      }
      locked = false; el("btnQuitSave").disabled = false; renderBoardState(); return;
    }
    
    const specialsToCreate = []; const claimedCells = new Set();
    
    lines.forEach(line => {
      if (line.length >= 4) {
        const type = line.length >= 5 ? "soy" : "wasabi";
        let cell = null;
        if (swapAction && tier === 1) {
          const keys = line.cells.map(c => c.r+"_"+c.c);
          if (keys.includes(swapAction.r1+"_"+swapAction.c1)) cell = {r:swapAction.r1, c:swapAction.c1};
          else if (keys.includes(swapAction.r2+"_"+swapAction.c2)) cell = {r:swapAction.r2, c:swapAction.c2};
        }
        if (!cell) cell = line.cells[Math.floor(line.length / 2)];
        if (cell && !claimedCells.has(cell.r+"_"+cell.c)) { claimedCells.add(cell.r+"_"+cell.c); specialsToCreate.push({r: cell.r, c: cell.c, type}); }
      }
    });
    
    if(tier === CONFIG.combo.rocketTier || tier === CONFIG.combo.tempuraTier || tier === CONFIG.combo.rainbowTier) {
      const rw = tier===CONFIG.combo.rocketTier ? 'rocket' : tier===CONFIG.combo.tempuraTier ? 'tempura' : 'rainbow';
      let empties = [];
      for(let r=0;r<SIZE;r++) for(let c=0;c<SIZE;c++) if(board.get(r,c) && board.isStandard(board.get(r,c).type) && !claimedCells.has(r+"_"+c)) empties.push({r,c});
      if(empties.length > 0) {
        const tgt = empties[Math.floor(Math.random()*empties.length)];
        claimedCells.add(tgt.r+"_"+tgt.c); specialsToCreate.push({r:tgt.r, c:tgt.c, type:rw});
        showFloatText("✨ Combo Drop! ✨", tgt.r, tgt.c, tier);
      }
    }
    
    const clearSet = new Map();
    lines.forEach(line => line.cells.forEach(c => { const k = c.r+"_"+c.c; if (!claimedCells.has(k)) clearSet.set(k, {r: c.r, c: c.c}); }));
    powerComboArea.forEach(c => { const k = c.r+"_"+c.c; if (!claimedCells.has(k)) clearSet.set(k, {r: c.r, c: c.c}); });
    
    const triggeredPowerUps = new Set();
    const powerUpQueue = [...directTriggers];
    let pCount = 0;
    const triggeredTypes = {};
    
    while(powerUpQueue.length > 0) {
      const {r, c} = powerUpQueue.shift(); const key = r+"_"+c;
      if (triggeredPowerUps.has(key)) continue;
      const tile = board.get(r, c); if (!tile || !board.isPowerUp(r, c)) continue;
      
      triggeredPowerUps.add(key); clearSet.set(key, {r, c}); pCount++; triggeredTypes[tile.type]=(triggeredTypes[tile.type]||0)+1;
      
      const rad = tile.type === 'wasabi' ? 1 : tile.type === 'tempura' ? 2 : 0;
      if (rad > 0) {
        for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
          const nr = r + dr, nc = c + dc;
          if (board.inBounds(nr, nc)) {
            const nkey = nr+"_"+nc;
            if (!claimedCells.has(nkey)) { clearSet.set(nkey, {r: nr, c: nc}); if (board.isPowerUp(nr, nc) && !triggeredPowerUps.has(nkey)) powerUpQueue.push({r: nr, c: nc}); }
          }
        }
      }
      if (tile.type === "soy" || tile.type === "rocket") {
        const doRow = true; const doCol = true;
        if(doCol) for (let rr = 0; rr < SIZE; rr++) { const nkey = rr+"_"+c; if (!claimedCells.has(nkey)) { clearSet.set(nkey, {r: rr, c}); if (board.isPowerUp(rr, c) && !triggeredPowerUps.has(nkey)) powerUpQueue.push({r: rr, c}); } }
        if(doRow) for (let cc = 0; cc < SIZE; cc++) { const nkey = r+"_"+cc; if (!claimedCells.has(nkey)) { clearSet.set(nkey, {r, c: cc}); if (board.isPowerUp(r, cc) && !triggeredPowerUps.has(nkey)) powerUpQueue.push({r, c: cc}); } }
      }
      if (tile.type === "rainbow") {
        const types = board.activeTypes; const tgt = types[Math.floor(Math.random()*types.length)];
        for (let rr=0; rr<SIZE; rr++) for(let cc=0; cc<SIZE; cc++){
           const t = board.get(rr,cc);
           if(t && t.type === tgt) {
             const nkey = rr+"_"+cc;
             if (!claimedCells.has(nkey)) { clearSet.set(nkey, {r: rr, c:cc}); if (board.isPowerUp(rr, cc) && !triggeredPowerUps.has(nkey)) powerUpQueue.push({r: rr, c:cc}); }
           }
        }
      }
    }
    
    if(pCount>0) { 
      totalPowerupsThisRun += pCount;
      save.stats.totalPowerups += pCount; Persistence.save(save); 
      CustomerSystem.react('powerup', patience, mode);
      const currentOrd = OrderSystem.getOrder();
      if (currentOrd && currentOrd.category === 'powerup') {
        const matched=(triggeredTypes[currentOrd.powerupType]||0); currentOrd.have = Math.min(currentOrd.need, currentOrd.have + matched);
      }
    }

    let clearCount = 0; const typeCounts = {};
    clearSet.forEach(({r, c}) => {
      const tile = board.get(r, c);
      if (tile && board.isStandard(tile.type)) { clearCount++; typeCounts[tile.type] = (typeCounts[tile.type] || 0) + 1; }
    });
    
    if (clearCount > 0) addScore(clearCount * CONFIG.scoring.clearPointsPerTile * tier);
    
    if(tier >= CONFIG.combo.rocketTier) {
      CustomerSystem.react('bigCombo', patience, mode);
      const currentOrd = OrderSystem.getOrder();
      if (currentOrd && currentOrd.category === 'combo' && tier >= currentOrd.targetCombo) {
        currentOrd.have = currentOrd.need;
      }
      if (currentOrd && currentOrd.category === 'vip' && tier >= currentOrd.targetCombo) {
        currentOrd.comboAchieved = true;
      }
    }

    const currentOrd = OrderSystem.getOrder();
    if (currentOrd) {
      if (currentOrd.category === 'basic') {
        if (typeCounts[currentOrd.type]) {
          currentOrd.have = Math.min(currentOrd.need, currentOrd.have + typeCounts[currentOrd.type]);
        }
      } else if (currentOrd.category === 'mixed') {
        if (typeCounts[currentOrd.type]) currentOrd.have = Math.min(currentOrd.need, currentOrd.have + typeCounts[currentOrd.type]);
        if (typeCounts[currentOrd.secondaryType]) currentOrd.secondaryHave = Math.min(currentOrd.secondaryNeed, currentOrd.secondaryHave + typeCounts[currentOrd.secondaryType]);
      } else if (currentOrd.category === 'speed') {
        if (typeCounts[currentOrd.type]) {
          currentOrd.have = Math.min(currentOrd.need, currentOrd.have + typeCounts[currentOrd.type]);
        }
      } else if (currentOrd.category === 'vip') {
        if (typeCounts[currentOrd.type]) {
          currentOrd.have = Math.min(currentOrd.need, currentOrd.have + typeCounts[currentOrd.type]);
        }
      }

      if (currentOrd.category === 'mixed') {
        el("customerProgressText").textContent = `${currentOrd.have}/${currentOrd.need} | ${currentOrd.secondaryHave}/${currentOrd.secondaryNeed}`;
        if (currentOrd.have >= currentOrd.need && currentOrd.secondaryHave >= currentOrd.secondaryNeed) {
          completeOrder();
        }
      } else if (currentOrd.category === 'vip') {
        el("customerProgressText").textContent = `${currentOrd.have}/${currentOrd.need} | Combo: ${currentOrd.comboAchieved?'✓':'×4'}`;
        if (currentOrd.have >= currentOrd.need && currentOrd.comboAchieved) {
          completeOrder();
        }
      } else {
        el("customerProgressText").textContent = `${currentOrd.have} / ${currentOrd.need}`;
        if (currentOrd.have >= currentOrd.need) {
          completeOrder();
        }
      }
    }
    
    if (clearSet.size > 0 || triggeredPowerUps.size > 0) {
      if (clearCount > 0) AudioEngine.matchPop(tier);
      if (triggeredPowerUps.size > 0) { AudioEngine.powerupBlast(); shakeBoard(tier >= CONFIG.combo.tempuraTier ? 1.5 : 1); }
      
      triggeredPowerUps.forEach(key => {
        const [rStr, cStr] = key.split("_"); const tEl = getTileEl(Number(rStr), Number(cStr));
        if(tEl) tEl.classList.add(board.get(rStr,cStr)?.type==='wasabi' ? "bomb-flash" : "splash-flash");
      });
      clearSet.forEach(({r, c}) => { const tEl = getTileEl(r, c); if(tEl) tEl.classList.add("clearing"); });
      
      if (tier > 1) { 
        const arr = Array.from(clearSet.values()); 
        if(arr.length>0) {
          let txt = "COMBO ×" + tier + "!";
          if (tier >= CONFIG.combo.legendaryTier) txt = "🔥 LEGENDARY ×" + tier + "! 🔥";
          else if (tier >= CONFIG.combo.rainbowTier) txt = "🌟 INSANE COMBO! 🌟";
          else if (tier >= CONFIG.combo.tempuraTier) txt = "💥 GREAT COMBO! 💥";
          else if (tier >= CONFIG.combo.rocketTier) txt = "✨ GOOD COMBO! ✨";
          showFloatText(txt, arr[0].r, arr[0].c, tier);
          shakeBoard(tier >= CONFIG.combo.rainbowTier ? 1.4 : 0.8);
        }
      }
      
      await wait(CONFIG.animation.clearWaitMs); if (token !== activeSessionToken) return;
    }
    
    clearSet.forEach(({r, c}) => { const tEl = getTileEl(r, c); if(tEl) tEl.remove(); board.set(r, c, null); });
    specialsToCreate.forEach(s => board.set(s.r, s.c, board.newTile(s.type)));
    
    FLIP.record(boardEl); const spawned = board.applyGravityAndRefill(); renderBoardState();
    
    spawned.forEach(({r, c, tile}) => {
      const tEl = document.getElementById("tile-"+tile.id);
      if(tEl) { tEl.style.transition = 'none'; tEl.style.transform = `translateY(-${(r + 1) * 110}%)`; tEl.offsetHeight; }
    });
    
    FLIP.play(boardEl, CONFIG.animation.gravityMs);
    spawned.forEach(({r, c, tile}) => {
      const tEl = document.getElementById("tile-"+tile.id);
      if(tEl) { tEl.style.transition = `transform ${CONFIG.animation.gravityMs}ms ease-in`; tEl.style.transform = `translateY(0)`; }
    });
    
    await wait(CONFIG.animation.postGravityWaitMs); if (token !== activeSessionToken) return;
    spawned.forEach(({r, c, tile}) => { const tEl = document.getElementById("tile-"+tile.id); if(tEl) { tEl.style.transition = ''; tEl.style.transform = ''; } });
    
    await resolveBoard(token, tier + 1);
  }

  function onTileActivate(r, c) {
    if (!canInteract()) return;
    clearHints();
    if (!selected) { selected = {r, c}; renderBoardState(); return; }
    if (selected.r === r && selected.c === c) { selected = null; renderBoardState(); return; }
    if (Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1) { const sr = selected.r, sc = selected.c; selected = null; submitSwap(sr, sc, r, c); }
    else { selected = {r, c}; renderBoardState(); }
  }

  let touchState = null;
  boardEl.addEventListener("pointerdown", e => {
    clearHints();
    const t = e.target.closest(".tile"); if (!t || !canInteract()) return;
    touchState = { id: e.pointerId, startX: e.clientX, startY: e.clientY, r: parseInt(t.dataset.r, 10), c: parseInt(t.dataset.c, 10) };
    t.setPointerCapture(e.pointerId);
  });
  
  boardEl.addEventListener("pointerup", e => {
    if (!touchState || touchState.id !== e.pointerId) return;
    const dx = e.clientX - touchState.startX, dy = e.clientY - touchState.startY, dist = Math.hypot(dx, dy);
    const r = touchState.r, c = touchState.c; touchState = null;
    
    if (dist < Math.max(16, (boardEl.clientWidth/SIZE)*0.3)) { onTileActivate(r, c); } 
    else {
      let tr = r, tc = c;
      if (Math.abs(dx) > Math.abs(dy)) tc += dx > 0 ? 1 : -1; else tr += dy > 0 ? 1 : -1;
      if (!board.inBounds(tr, tc)) { AudioEngine.invalidSwap(); CustomerSystem.react('mistake', patience, mode); const tEl = getTileEl(r, c); if(tEl) { tEl.classList.add("shake-invalid"); setTimeout(() => tEl.classList.remove("shake-invalid"), 320); } return; }
      selected = null; submitSwap(r, c, tr, tc);
    }
  });

  boardEl.addEventListener("keydown", (e) => {
    if (!canInteract()) return;
    clearHints();
    let dr = 0, dc = 0;
    if (e.key === "ArrowUp") dr = -1; else if (e.key === "ArrowDown") dr = 1; else if (e.key === "ArrowLeft") dc = -1; else if (e.key === "ArrowRight") dc = 1;
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTileActivate(keyboardFocus.r, keyboardFocus.c); return; }
    
    if (dr !== 0 || dc !== 0) {
      e.preventDefault(); const nr = keyboardFocus.r + dr, nc = keyboardFocus.c + dc;
      if (board.inBounds(nr, nc)) { keyboardFocus = {r: nr, c: nc}; renderBoardState(); getTileEl(nr, nc)?.focus(); }
    }
  });

  function startRun(selectedMode){
    AudioEngine.ensure();
    mode = selectedMode; phase = Phase.PLAYING; activeSessionToken++;
    
    score=0; bestComboRun=0; coinsEarned=0;
    totalPowerupsThisRun=0; maxCascadeTierThisRun=0;
    ProgressionSystem.reset();
    selected=null; locked=false; patience=CONFIG.patience.start; dailyTimeLeft=CONFIG.daily.durationSec; idleTime=0;
    patienceDecayPerSec=CONFIG.patience.decayPerSecBase; keyboardFocus={r: 3, c: 3};
    
    el("scoreLabel").textContent=0; el("levelLabel").textContent=1; el("ordersLabel").textContent=0; el("comboLabel").textContent="×0";
    board.updateActiveTypes(1); board.generateInitialBoard();
    boardEl.innerHTML = ""; renderBoardState();
    
    el("patienceBox").classList.toggle("hidden", mode==="zen");
    el("patienceTitle").textContent = mode==="daily" ? "Time Left" : "Patience";
    
    nextCustomerAndOrder(); updatePatienceUI(); updateComboUI(0);

    el("screen-title").classList.add("hidden"); el("screen-game").classList.remove("hidden");
    paused=false; lastFrameTime=null; requestAnimationFrame(tickGameLoop);
  }

  function endRun(isTimeout = false){
    paused = true; locked = true; phase = Phase.GAMEOVER; activeSessionToken++;
    const save = Persistence.get();
    
    if(mode==="arcade" && score > save.bestArcadeScore) save.bestArcadeScore = score;
    if(mode==="zen" && score > save.bestZenScore) save.bestZenScore = score;
    if(mode==="daily" && score > save.bestDailyScore) save.bestDailyScore = score;
    
    coinsEarned = Math.floor(score / (mode==="zen" ? CONFIG.scoring.coinsPerPointZen : CONFIG.scoring.coinsPerPointArcade));
    save.coins += coinsEarned;
    Persistence.save(save); MetaSystem.checkAchievements();
    
    el("goScore").textContent = score; el("goCoins").textContent = "+" + coinsEarned;
    el("goLevel").textContent = ProgressionSystem.getLevel(); el("goOrders").textContent = ProgressionSystem.getOrdersDone(); el("goCombo").textContent = "×"+bestComboRun;
    el("goPowerups").textContent = totalPowerupsThisRun;
    el("goMaxCascade").textContent = "×" + maxCascadeTierThisRun;
    
    if (isTimeout) {
      AudioEngine.gameOver();
      el("goTitle").textContent = mode==="daily" ? "⏰ Time's Up!" : "😡 Customer Walked!";
    } else {
      el("goTitle").textContent = "🎉 Shift Saved! 🎉";
    }
    
    el("gameOverOverlay").classList.remove("hidden"); el("goCard").focus();
  }

  function bindUI(){
    el("cardArcade").addEventListener("click", ()=> startRun("arcade"));
    el("cardZen").addEventListener("click", ()=> startRun("zen"));
    el("cardDaily").addEventListener("click", ()=> startRun("daily"));

    ['howTo', 'skins', 'achievements'].forEach(mod => {
      const btn = el(`btn${mod.charAt(0).toUpperCase() + mod.slice(1)}`);
      const over = el(`${mod}Overlay`); const card = el(`${mod}Card`);
      if(btn) btn.addEventListener("click", ()=> { over.classList.remove("hidden"); card.focus(); });
      el(`btnClose${mod.charAt(0).toUpperCase() + mod.slice(1)}`).addEventListener("click", ()=> over.classList.add("hidden"));
    });
    el("btnHowToGame").addEventListener("click", ()=> { el("howToOverlay").classList.remove("hidden"); el("howToCard").focus(); });

    function toggleSound(){
      AudioEngine.ensure(); AudioEngine.setEnabled(!AudioEngine.isEnabled());
      el("btnSoundToggleTitle").textContent = AudioEngine.isEnabled() ? "🔊 Sound On" : "🔇 Sound Off";
      el("btnSoundToggleGame").textContent = AudioEngine.isEnabled() ? "🔊" : "🔇";
      const s = Persistence.get(); s.soundOn = AudioEngine.isEnabled(); Persistence.save(s);
    }
    el("btnSoundToggleTitle").addEventListener("click", toggleSound); el("btnSoundToggleGame").addEventListener("click", toggleSound);
    
    el("btnQuitSave").addEventListener("click", ()=> endRun(false));
    el("btnPlayAgain").addEventListener("click", ()=> { el("gameOverOverlay").classList.add("hidden"); startRun(mode); });
    el("btnReturnKitchenGO").addEventListener("click", ()=> {
      el("gameOverOverlay").classList.add("hidden"); el("screen-game").classList.add("hidden"); el("screen-title").classList.remove("hidden");
      mode = null; phase = Phase.TITLE; MetaSystem.updateMetaUI();
      el("bestArcadeLabel").textContent = "Best score: " + Persistence.get().bestArcadeScore;
      el("bestZenLabel").textContent = "Best score: " + Persistence.get().bestZenScore;
      el("bestDailyLabel").textContent = "Best score: " + Persistence.get().bestDailyScore;
    });
    
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { document.querySelectorAll('.overlay-back:not(#gameOverOverlay)').forEach(o => o.classList.add('hidden')); }
    });
  }

  return { init, bindUI };
})();

Persistence.load();
GameController.init();
GameController.bindUI();
document.getElementById("bestArcadeLabel").textContent = "Best score: " + Persistence.get().bestArcadeScore;
document.getElementById("bestZenLabel").textContent = "Best score: " + Persistence.get().bestZenScore;
document.getElementById("bestDailyLabel").textContent = "Best score: " + (Persistence.get().bestDailyScore || 0);

if(Persistence.get().soundOn === false) {
  document.getElementById("btnSoundToggleTitle").textContent = "🔇 Sound Off";
  document.getElementById("btnSoundToggleGame").textContent = "🔇";
  AudioEngine.setEnabled(false);
}
