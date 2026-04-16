import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  "https://ochahqbfrrzuevrzjadc.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jaGFocWJmcnJ6dWV2cnpqYWRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxNDMzOTIsImV4cCI6MjA4NzcxOTM5Mn0.x0WUNHo62H4Y7bs8sGet6sKuz9HlfGwqQ3GZNxS64Sw"
);

// ─────────────────────────────────────────────────────────────────────────────
// 8-BIT SOUND ENGINE
// ─────────────────────────────────────────────────────────────────────────────
let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === "suspended") _ctx.resume();
  return _ctx;
}
function beep({ freq = 440, type = "square", dur = 0.1, vol = 0.25, delay = 0 }) {
  try {
    const ctx = getCtx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    g.gain.setValueAtTime(vol, ctx.currentTime + delay);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
    o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + dur + 0.01);
  } catch {}
}
const Sounds = {
  play:    () => { beep({ freq: 523, dur: 0.06 }); beep({ freq: 659, dur: 0.06, delay: 0.06 }); },
  draw:    () => { beep({ freq: 330, dur: 0.08 }); beep({ freq: 262, dur: 0.08, delay: 0.08 }); },
  draw4:   () => [400,350,300,250,200].forEach((f,i) => beep({ freq: f, type:"sawtooth", dur:0.12, vol:0.3, delay:i*0.1 })),
  turn:    () => [262,330,392,523].forEach((f,i) => beep({ freq: f, dur:0.1, delay:i*0.08 })),
  error:   () => { beep({ freq:150, type:"sawtooth", dur:0.15 }); beep({ freq:120, type:"sawtooth", dur:0.2, delay:0.15 }); },
  mercy:   () => [330,415,523,659,784].forEach((f,i) => beep({ freq:f, type:"triangle", dur:0.18, vol:0.22, delay:i*0.09 })),
  win:     () => [523,523,523,523,415,466,523,466,523].forEach((f,i) => beep({ freq:f, dur:0.15, delay:i*0.12 })),
  timer:   () => { beep({ freq:880, dur:0.08, vol:0.2 }); beep({ freq:880, dur:0.08, vol:0.2, delay:0.15 }); },
};

// ─────────────────────────────────────────────────────────────────────────────
// GAME DATA — 12 main families (pool to choose 4 from)
// ─────────────────────────────────────────────────────────────────────────────
export const ALL_FAMILIES = [
  { id:"because",   label:"because",    variants:["owing to","due to"],                                color:"blue",   usage:"Cause / reason"        },
  { id:"even",      label:"even though",variants:["though","although","albeit"],                        color:"gray",   usage:"Concession / contrast" },
  { id:"but",       label:"but",        variants:["however","nevertheless","on the contrary"],          color:"yellow", usage:"Contrast / opposition" },
  { id:"so",        label:"so",         variants:["therefore","consequently","as a result"],            color:"blue",   usage:"Result / consequence"  },
  { id:"like",      label:"like",       variants:["especially","similarly","likewise","correspondingly"],color:"gray",  usage:"Comparison"            },
  { id:"also",      label:"also",       variants:["additionally","besides","what's more"],              color:"yellow", usage:"Addition / listing"    },
  { id:"thats_why", label:"that's why", variants:["hence","thus","accordingly"],                        color:"blue",   usage:"Logical consequence"   },
  { id:"really",    label:"really",     variants:["indeed","undoubtedly","significantly"],              color:"gray",   usage:"Emphasis / certainty"  },
  { id:"very",      label:"very",       variants:["extremely","exceptionally"],                         color:"yellow", usage:"Degree intensifier"    },
  { id:"before",    label:"before",     variants:["prior to","earlier","previously"],                   color:"blue",   usage:"Time — prior"          },
  { id:"then",      label:"then",       variants:["afterward","following that","thereafter"],            color:"gray",   usage:"Time — next"           },
  { id:"or",        label:"or",         variants:["alternatively","otherwise","conversely"],             color:"yellow", usage:"Alternative / option"  },
];

const COLOR_CFG = {
  blue:   { bg:"from-blue-500 to-blue-700",   border:"border-blue-400",  badge:"bg-blue-100 text-blue-800",   label:"Casual", glow:"shadow-blue-500/50"  },
  gray:   { bg:"from-slate-500 to-slate-700",  border:"border-slate-400", badge:"bg-slate-100 text-slate-800", label:"Neutral",glow:"shadow-slate-400/50" },
  yellow: { bg:"from-amber-400 to-amber-600",  border:"border-amber-300", badge:"bg-amber-100 text-amber-800", label:"Formal", glow:"shadow-amber-400/50" },
};

// ─────────────────────────────────────────────────────────────────────────────
// GAME LOGIC
// ─────────────────────────────────────────────────────────────────────────────
function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}

// Build deck from exactly 4 chosen families, each card x4
function buildDeck(selectedFamilyIds) {
  const cards = []; let id = 0;
  const families = ALL_FAMILIES.filter(f => selectedFamilyIds.includes(f.id));
  for (const fam of families) {
    const allMembers = [fam.label, ...fam.variants]; // main + variants
    for (const member of allMembers) {
      for (let i = 0; i < 4; i++) {
        cards.push({ id: id++, type:"connector", familyId:fam.id, connector:member, color:fam.color, usage:fam.usage });
      }
    }
  }
  // Wildcards — scaled to deck size
  for (const wType of ["change_connector","draw_2","draw_4"]) {
    for (let i = 0; i < 6; i++) {
      cards.push({ id: id++, type:"wildcard", wildcard:wType, color:"wild", familyId:null });
    }
  }
  return shuffle(cards);
}

function canPlay(card, topCard, currentFamily) {
  if (card.type === "wildcard") return true;
  if (topCard.type === "wildcard") return card.familyId === currentFamily;
  return card.familyId === topCard.familyId;
}

// Returns true if player has no playable card AND draw pile is empty
function isPlayerStuck(hand, drawPile, topCard, currentFamily) {
  if(drawPile.length > 0) return false;
  return !hand.some(c => canPlay(c, topCard, currentFamily));
}

// Check if ALL players are stuck → stalemate
function checkStalemate(g) {
  const topCard = g.discardPile[g.discardPile.length-1];
  return g.players.every(p => isPlayerStuck(g.hands[p.id]||[], g.drawPile, topCard, g.currentFamily));
}

function initGameState(players, selectedFamilyIds) {
  const deck = buildDeck(selectedFamilyIds);
  const hands = {}; const remaining = [...deck];
  for (const p of players) {
    hands[p.id] = [];
    for (let i = 0; i < 7; i++) hands[p.id].push(remaining.shift());
  }
  let topIdx = remaining.findIndex(c => c.type === "connector");
  const topCard = remaining.splice(topIdx, 1)[0];
  return {
    phase: "playing",
    players: players.map(p => ({ id:p.id, name:p.name })),
    hands, drawPile: remaining, discardPile: [topCard],
    currentPlayerIdx: 0, currentFamily: topCard.familyId,
    direction: 1, winner: null, timeUp: false,
    lastAction: "Game started!",
    consecutiveUselessDraws: {},
    selectedFamilyIds,
    startedAt: Date.now(),
    cardsPlayed: Object.fromEntries(players.map(p => [p.id, 0])),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOTEM OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function TotemOverlay({ type, onDone }) {
  const isDraw4 = type==="draw4", isMercy = type==="mercy";
  useEffect(() => { const t = setTimeout(onDone, isDraw4?2400:2000); return ()=>clearTimeout(t); }, []);
  const accent  = isDraw4?"#ef4444":isMercy?"#a855f7":"#10b981";
  const accent2 = isDraw4?"#f97316":isMercy?"#c084fc":"#34d399";
  const pixels  = [[0,0,1,1,1,1,0,0],[0,1,1,1,1,1,1,0],[1,1,0,1,1,0,1,1],[1,1,1,1,1,1,1,1],[1,1,0,0,0,0,1,1],[0,1,1,0,0,1,1,0],[0,0,1,1,1,1,0,0],[0,1,1,0,0,1,1,0]];
  const pColors = isDraw4?["#ef4444","#dc2626","#f97316","#b91c1c"]:isMercy?["#a855f7","#9333ea","#c084fc","#7e22ce"]:["#10b981","#059669","#34d399","#065f46"];
  return (
    <motion.div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden select-none"
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0,transition:{duration:0.3}}}
      style={{background:isDraw4?"rgba(10,0,0,0.94)":isMercy?"rgba(5,0,15,0.94)":"rgba(0,10,5,0.94)"}}>
      <div className="absolute inset-0 pointer-events-none" style={{backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.18) 2px,rgba(0,0,0,0.18) 4px)"}}/>
      {[...Array(20)].map((_,i)=>(
        <motion.div key={i} className="absolute top-1/2 left-1/2" style={{width:"55vw",height:3,transformOrigin:"0% 50%",rotate:`${i*18}deg`,marginTop:-1.5}}
          initial={{scaleX:0,opacity:0}} animate={{scaleX:[0,1,0.8,0],opacity:[0,0.9,0.6,0]}} transition={{duration:2.2,ease:"easeOut"}}>
          <div style={{width:"100%",height:"100%",background:`linear-gradient(90deg,${accent},transparent)`}}/>
        </motion.div>
      ))}
      <motion.div className="relative z-20 mb-6" initial={{scale:0,rotate:-15}} animate={{scale:[0,1.5,1.1,1.3,1.05],rotate:[-15,8,-5,3,0]}} transition={{duration:0.7}}>
        <motion.div className="absolute rounded-full blur-3xl" style={{width:160,height:160,top:"50%",left:"50%",transform:"translate(-50%,-50%)",backgroundColor:`${accent}55`}} animate={{scale:[1,1.4,1]}} transition={{duration:0.7,repeat:Infinity}}/>
        <div style={{imageRendering:"pixelated"}}>
          {pixels.map((row,ri)=>(
            <motion.div key={ri} className="flex" initial={{opacity:0,x:ri%2===0?-20:20}} animate={{opacity:1,x:0}} transition={{delay:ri*0.04}}>
              {row.map((cell,ci)=>(
                <motion.div key={ci} style={{width:18,height:18,backgroundColor:cell?pColors[(ri*3+ci)%pColors.length]:"transparent",boxShadow:cell?`0 0 8px ${pColors[(ri*3+ci)%pColors.length]}`:"none"}}
                  animate={cell?{opacity:[1,0.7,1]}:{}} transition={{duration:0.4,repeat:Infinity,delay:(ri+ci)*0.05}}/>
              ))}
            </motion.div>
          ))}
        </div>
      </motion.div>
      <motion.div className="relative z-20 text-center px-6" initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} transition={{delay:0.25}}>
        {isDraw4?(<>
          <motion.div className="text-6xl font-black mb-2 tracking-wider" style={{color:accent,fontFamily:"monospace",textShadow:`0 0 30px ${accent},3px 3px 0 #450a0a`}} animate={{scale:[1,1.06,1],color:[accent,accent2,accent]}} transition={{duration:0.35,repeat:5}}>+4 CARDS!</motion.div>
          <motion.p className="text-2xl font-bold" style={{color:accent2,fontFamily:"monospace"}} animate={{opacity:[1,0.4,1]}} transition={{duration:0.25,repeat:7}}>YOU GOT WRECKED 💀</motion.p>
        </>):isMercy?(<>
          <motion.div className="text-5xl font-black mb-2 tracking-wider" style={{color:accent,fontFamily:"monospace",textShadow:`0 0 30px ${accent}`}} animate={{scale:[1,1.07,1]}} transition={{duration:0.5,repeat:3}}>MERCY CARD!</motion.div>
          <motion.p className="text-xl font-bold" style={{color:accent2,fontFamily:"monospace"}} animate={{opacity:[1,0.3,1]}} transition={{duration:0.5,repeat:4}}>✨ GUARANTEED PLAYABLE ✨</motion.p>
        </>):(<>
          <motion.div className="text-6xl font-black mb-2 tracking-wider" style={{color:accent,fontFamily:"monospace",textShadow:`0 0 30px ${accent},3px 3px 0 #022c22`}} animate={{scale:[1,1.07,1]}} transition={{duration:0.5,repeat:3}}>YOUR TURN!</motion.div>
          <motion.p className="text-2xl font-bold" style={{color:accent2,fontFamily:"monospace"}} animate={{opacity:[1,0.3,1]}} transition={{duration:0.5,repeat:4}}>▶ PLAY A CARD ◀</motion.p>
        </>)}
      </motion.div>
      {[{t:"5%",l:"5%"},{t:"5%",r:"5%"},{b:"8%",l:"5%"},{b:"8%",r:"5%"}].map((pos,i)=>(
        <motion.div key={i} className="absolute z-20 text-3xl" style={{top:pos.t,bottom:pos.b,left:pos.l,right:pos.r,fontFamily:"monospace",color:accent,textShadow:`0 0 12px ${accent}`}} animate={{rotate:[0,360],scale:[1,1.4,1]}} transition={{duration:1.2,delay:i*0.15,repeat:Infinity}}>
          {isDraw4?"💀":isMercy?"✨":"✦"}
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD FACE
// ─────────────────────────────────────────────────────────────────────────────
function CardFace({ card, small=false, faceDown=false }) {
  if (faceDown) return (
    <div className={`rounded-xl border-2 border-white/20 bg-gradient-to-br from-indigo-900 to-purple-900 ${small?"w-10 h-14":"w-16 h-24 sm:w-20 sm:h-28"} flex items-center justify-center relative overflow-hidden`}>
      <div className="absolute inset-0 opacity-20">{[...Array(5)].map((_,i)=><div key={i} className="absolute border border-white/30 rounded-full" style={{width:`${30+i*14}%`,height:`${30+i*14}%`,top:"50%",left:"50%",transform:"translate(-50%,-50%)"}}/>)}</div>
      <span className="text-white font-black text-sm opacity-50">CM</span>
    </div>
  );
  if (card.type==="wildcard") {
    const icons={change_connector:"🔄",draw_2:"+2",draw_4:"+4"}, labels={change_connector:"Change\nFamily",draw_2:"Draw 2",draw_4:"Draw 4"};
    return (
      <div className={`rounded-xl border-2 border-white/40 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 ${small?"w-10 h-14":"w-16 h-24 sm:w-20 sm:h-28"} flex flex-col items-center justify-center gap-1 relative overflow-hidden shadow-lg shadow-purple-500/40`}>
        <span className={small?"text-base":"text-2xl"}>{icons[card.wildcard]}</span>
        {!small&&<span className="text-white text-[9px] font-bold text-center leading-tight whitespace-pre-line">{labels[card.wildcard]}</span>}
      </div>
    );
  }
  const cfg = COLOR_CFG[card.color];
  return (
    <div className={`rounded-xl border-2 ${cfg.border} bg-gradient-to-br ${cfg.bg} ${small?"w-10 h-14":"w-16 h-24 sm:w-20 sm:h-28"} flex flex-col items-center justify-center px-1 gap-0.5 relative overflow-hidden shadow-lg ${cfg.glow}`}>
      {!small&&<span className={`text-[8px] font-semibold ${cfg.badge} rounded px-1 py-0.5 uppercase tracking-wide`}>{cfg.label}</span>}
      <span className={`${small?"text-[7px]":"text-sm sm:text-base"} font-black text-white text-center leading-tight`}>{card.connector}</span>
      {!small&&<span className="text-[7px] text-white/80 text-center leading-tight px-1">{card.usage}</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HAND CARD (click only)
// ─────────────────────────────────────────────────────────────────────────────
function HandCard({ card, onClick, isMyTurn }) {
  return (
    <motion.div whileHover={isMyTurn?{y:-12,scale:1.08}:{}} whileTap={isMyTurn?{scale:0.94}:{}}
      onClick={()=>{ if(isMyTurn) onClick(card); }}
      className={`flex-shrink-0 drop-shadow-xl ${isMyTurn?"cursor-pointer":"cursor-default"}`}
      style={{touchAction:"manipulation"}}>
      <CardFace card={card}/>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HAND CAROUSEL (swipe mobile / arrows desktop)
// ─────────────────────────────────────────────────────────────────────────────
function HandCarousel({ myHand, handlePlayCard, isMyTurn }) {
  const scrollRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const check = useCallback(()=>{
    const el=scrollRef.current; if(!el) return;
    setCanLeft(el.scrollLeft>4);
    setCanRight(el.scrollLeft+el.clientWidth<el.scrollWidth-4);
  },[]);
  useEffect(()=>{
    check();
    const el=scrollRef.current; if(!el) return;
    el.addEventListener("scroll",check,{passive:true});
    window.addEventListener("resize",check);
    return()=>{ el.removeEventListener("scroll",check); window.removeEventListener("resize",check); };
  },[myHand.length,check]);
  const scroll=(dir)=>scrollRef.current?.scrollBy({left:dir*160,behavior:"smooth"});
  return (
    <div className="bg-black/50 backdrop-blur border-t border-white/5">
      <div className="px-3 pt-2 pb-0.5 flex items-center justify-between">
        <span className="text-white/50 text-[10px] font-bold uppercase tracking-wide">Your Hand ({myHand.length})</span>
        {isMyTurn&&<span className="text-emerald-400 text-[10px] font-bold">Your turn</span>}
      </div>
      <div className="relative flex items-center">
        <AnimatePresence>
          {canLeft&&<motion.button initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-8}} onClick={()=>scroll(-1)} className="hidden sm:flex absolute left-0 z-10 h-full px-1.5 items-center bg-gradient-to-r from-black/80 to-transparent rounded-l-xl"><span className="text-white/70 text-xl font-black">‹</span></motion.button>}
        </AnimatePresence>
        <div ref={scrollRef} className="flex gap-1.5 px-3 pb-2 pt-0.5 overflow-x-auto w-full" style={{scrollSnapType:"x mandatory",WebkitOverflowScrolling:"touch",scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {myHand.map(card=>(
            <motion.div key={card.id} layout initial={{scale:0,y:30}} animate={{scale:1,y:0}} transition={{type:"spring",stiffness:400,damping:28}} style={{scrollSnapAlign:"start",flexShrink:0}}>
              <HandCard card={card} onClick={handlePlayCard} isMyTurn={isMyTurn}/>
            </motion.div>
          ))}
        </div>
        <AnimatePresence>
          {canRight&&<motion.button initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:8}} onClick={()=>scroll(1)} className="hidden sm:flex absolute right-0 z-10 h-full px-1.5 items-center bg-gradient-to-l from-black/80 to-transparent rounded-r-xl"><span className="text-white/70 text-xl font-black">›</span></motion.button>}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CELEBRATION PARTICLES
// ─────────────────────────────────────────────────────────────────────────────
function CelebrationParticles({ active }) {
  const pts = useMemo(()=>[...Array(60)].map((_,i)=>({id:i,x:Math.random()*100,color:["#f59e0b","#3b82f6","#ec4899","#10b981","#8b5cf6","#ef4444"][Math.floor(Math.random()*6)],size:6+Math.random()*10,delay:Math.random()*0.8})),[]);
  if(!active) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pts.map(p=><motion.div key={p.id} initial={{x:`${p.x}vw`,y:"-5vh",opacity:1,rotate:0}} animate={{y:"110vh",rotate:720,opacity:[1,1,0]}} transition={{duration:2+Math.random(),delay:p.delay,ease:"easeIn"}} style={{position:"absolute",width:p.size,height:p.size,borderRadius:Math.random()>.5?"50%":"2px",backgroundColor:p.color}}/>)}
    </div>
  );
}

function Toast({ message, type="info" }) {
  const c={error:"bg-red-600",success:"bg-green-600",info:"bg-indigo-600",warning:"bg-amber-500"};
  return <motion.div initial={{opacity:0,y:30,scale:0.9}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:-20,scale:0.9}} className={`${c[type]} text-white px-5 py-3 rounded-xl font-bold shadow-xl text-sm max-w-xs text-center`}>{message}</motion.div>;
}

function WildcardPicker({ families, onPick, onClose }) {
  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{scale:0.8,y:40}} animate={{scale:1,y:0}} exit={{scale:0.8}} onClick={e=>e.stopPropagation()} className="bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-sm w-full">
        <h3 className="text-white text-xl font-black mb-4 text-center">Choose Connector Family</h3>
        <div className="grid grid-cols-2 gap-2">
          {families.map(fam=>{
            const cfg=COLOR_CFG[fam.color];
            return <button key={fam.id} onClick={()=>onPick(fam.id)} className={`bg-gradient-to-br ${cfg.bg} text-white rounded-xl p-3 text-sm font-bold text-left hover:scale-105 active:scale-95 transition-transform border ${cfg.border}`}><div>{fam.label}</div><div className="text-xs opacity-70 font-normal mt-0.5">{fam.usage}</div></button>;
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TIMER DISPLAY
// ─────────────────────────────────────────────────────────────────────────────
function TimerDisplay({ startedAt, duration = 15 * 60 }) {
  const [remaining, setRemaining] = useState(duration);
  const warnedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(0, duration - elapsed);
      setRemaining(left);
      if (left <= 60 && !warnedRef.current) { warnedRef.current = true; Sounds.timer(); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, duration]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const isLow = remaining <= 60;
  const isVeryLow = remaining <= 30;

  return (
    <motion.div
      animate={isVeryLow ? { scale: [1, 1.08, 1] } : {}}
      transition={{ duration: 0.5, repeat: isVeryLow ? Infinity : 0 }}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-black tabular-nums ${isVeryLow ? "bg-red-500/30 text-red-300" : isLow ? "bg-amber-500/20 text-amber-300" : "bg-white/5 text-white/50"}`}
    >
      <span>⏱</span>
      <span>{String(mins).padStart(2,"0")}:{String(secs).padStart(2,"0")}</span>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function ResultsScreen({ game, playerId, onExit }) {
  const isStalemate = !!game.stalemate;
  // Stalemate: most cards wins. Time up: fewest cards wins.
  const ranked = [...game.players].sort((a, b) => {
    const aCards = (game.hands[a.id]||[]).length;
    const bCards = (game.hands[b.id]||[]).length;
    return isStalemate ? bCards - aCards : aCards - bCards;
  });

  const topCount = (game.hands[ranked[0].id]||[]).length;
  const winners = ranked.filter(p => (game.hands[p.id]||[]).length === topCount);
  const isWinner = winners.some(p => p.id === playerId);
  const isTie = winners.length > 1;

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{scale:0.5,y:80}} animate={{scale:1,y:0}} transition={{type:"spring",stiffness:240,damping:20}}
        className="bg-gradient-to-br from-gray-900 to-slate-900 border border-white/10 rounded-3xl p-6 max-w-sm w-full shadow-2xl">

        {/* Title */}
        <div className="text-center mb-5">
          <div className="text-5xl mb-2">{isStalemate ? "🧱" : isTie ? "🤝" : isWinner ? "🏆" : "🎯"}</div>
          <h2 className="text-2xl font-black text-white">
            {isStalemate && isTie
              ? "Stalemate — Tie!"
              : isStalemate
              ? (winners[0].id===playerId ? "You Resisted!" : `${winners[0].name} Resisted!`)
              : isTie ? "It's a Tie!"
              : isWinner ? "You Won!"
              : `${winners[0].name} Won!`}
          </h2>
          <p className="text-white/40 text-xs mt-1">
            {isStalemate ? "Everyone got stuck — most cards wins!" : "Time's up — final rankings"}
          </p>
        </div>

        {/* Ranking */}
        <div className="space-y-2 mb-5">
          {ranked.map((player, i) => {
            const handCount = (game.hands[player.id]||[]).length;
            const played = game.cardsPlayed?.[player.id] ?? 0;
            const isMe = player.id === playerId;
            const isWin = winners.some(w => w.id === player.id);
            return (
              <motion.div key={player.id} initial={{opacity:0,x:-20}} animate={{opacity:1,x:0}} transition={{delay:i*0.1}}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${isMe?"border-indigo-500/50 bg-indigo-500/10":"border-white/8 bg-white/[0.03]"}`}>
                <span className="text-xl font-black w-6 text-center">
                  {isWin ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i+1}.`}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-white font-bold text-sm">{player.name}</span>
                    {isMe && <span className="text-indigo-400 text-[9px] font-bold bg-indigo-400/10 px-1.5 rounded-full">YOU</span>}
                  </div>
                  <div className="text-white/40 text-[10px]">{played} cards played</div>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-black ${isWin?"text-amber-400":"text-white/60"}`}>{handCount}</div>
                  <div className="text-white/30 text-[9px]">in hand</div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {isTie && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-center">
            <p className="text-amber-300 text-xs font-bold">🎲 Tiebreaker coming soon: Rock Paper Scissors!</p>
          </div>
        )}

        <button onClick={onExit} className="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black rounded-xl text-sm">
          Back to Lobby
        </button>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOBBY SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function LobbyScreen({ onEnterRoom }) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState("create");
  const [roomCode, setRoomCode] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return setError("Enter your name!");
    setLoading(true);
    const code = Math.floor(1000+Math.random()*9000).toString();
    const playerId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { error: err } = await supabase.from("rooms").insert({
      id: code,
      game_state: { phase:"lobby", maxPlayers, players:[{id:playerId,name:name.trim()}], hostId:playerId, gameData:null },
      updated_at: new Date().toISOString(),
    });
    if (err) { setError("Could not create room."); setLoading(false); return; }
    onEnterRoom({ roomCode:code, playerId, playerName:name.trim(), isHost:true });
    setLoading(false);
  };

  const handleJoin = async () => {
    if (!name.trim()) return setError("Enter your name!");
    if (roomCode.length !== 4) return setError("Room code must be 4 digits!");
    setLoading(true);
    const { data, error: err } = await supabase.from("rooms").select("*").eq("id",roomCode).single();
    if (err||!data) { setError("Room not found!"); setLoading(false); return; }
    const gs = data.game_state;
    if (gs.phase !== "lobby") { setError("Game already started!"); setLoading(false); return; }
    if (gs.players.length >= gs.maxPlayers) { setError("Room is full!"); setLoading(false); return; }
    const playerId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { error: upErr } = await supabase.from("rooms").update({
      game_state: {...gs, players:[...gs.players,{id:playerId,name:name.trim()}]},
      updated_at: new Date().toISOString(),
    }).eq("id",roomCode);
    if (upErr) { setError("Could not join room."); setLoading(false); return; }
    onEnterRoom({ roomCode, playerId, playerName:name.trim(), isHost:false });
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0" style={{backgroundImage:"linear-gradient(rgba(99,102,241,0.08) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,0.08) 1px,transparent 1px)",backgroundSize:"40px 40px"}}/>
      <div className="absolute inset-0" style={{background:"radial-gradient(ellipse at center,rgba(99,102,241,0.15) 0%,transparent 70%)"}}/>
      {[...Array(8)].map((_,i)=><motion.div key={i} className="absolute opacity-10 rounded-xl border border-indigo-400/30" style={{width:64,height:90,left:`${10+i*12}%`,top:`${10+(i%3)*30}%`,rotate:-20+i*8}} animate={{y:[-8,8,-8],rotate:[-20+i*8-3,-20+i*8+3,-20+i*8-3]}} transition={{duration:3+i*0.5,repeat:Infinity,ease:"easeInOut"}}/>)}
      <motion.div initial={{opacity:0,y:30}} animate={{opacity:1,y:0}} transition={{duration:0.6}} className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <motion.div animate={{rotate:[0,-5,5,-5,0]}} transition={{duration:4,repeat:Infinity,repeatDelay:3}} className="inline-block text-5xl mb-3">🃏</motion.div>
          <h1 className="text-5xl font-black tracking-tighter"><span className="text-white">Connector</span><br/><span className="bg-gradient-to-r from-amber-400 via-orange-400 to-red-400 bg-clip-text text-transparent">Master</span></h1>
          <p className="text-indigo-400 mt-2 text-sm font-medium tracking-wide">Multiplayer English Connectors Game</p>
        </div>
        <div className="bg-white/[0.04] backdrop-blur-xl border border-white/10 rounded-3xl p-7 shadow-2xl">
          <div className="mb-5">
            <label className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-2 block">Your Name</label>
            <input type="text" value={name} onChange={e=>{setName(e.target.value);setError("");}} placeholder="Enter your name..." maxLength={20} className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-semibold"/>
          </div>
          <div className="flex rounded-xl bg-white/5 p-1 mb-5">
            {["create","join"].map(m=><button key={m} onClick={()=>setMode(m)} className={`flex-1 py-2.5 rounded-lg text-sm font-black transition-all ${mode===m?"bg-indigo-600 text-white shadow-lg":"text-white/40 hover:text-white/70"}`}>{m==="create"?"Create Room":"Join Room"}</button>)}
          </div>
          {mode==="create"?(
            <div className="space-y-4">
              <div>
                <label className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-3 block">Max Players: {maxPlayers}</label>
                <div className="flex gap-2">{[2,3,4,5].map(n=><button key={n} onClick={()=>setMaxPlayers(n)} className={`flex-1 py-2.5 rounded-xl text-sm font-black transition-all border ${maxPlayers===n?"bg-indigo-600 border-indigo-500 text-white":"border-white/10 text-white/40 hover:text-white/70"}`}>{n}</button>)}</div>
              </div>
              <motion.button whileTap={{scale:0.97}} onClick={handleCreate} disabled={loading} className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 disabled:opacity-50 text-white font-black rounded-xl text-lg shadow-xl transition-all">{loading?"Creating...":"Create Room 🚀"}</motion.button>
            </div>
          ):(
            <div className="space-y-4">
              <div>
                <label className="text-indigo-400 text-xs font-bold uppercase tracking-widest mb-2 block">Room Code</label>
                <input type="text" value={roomCode} onChange={e=>{setRoomCode(e.target.value.replace(/\D/g,"").slice(0,4));setError("");}} placeholder="1234" maxLength={4} className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-4 text-white placeholder-white/20 outline-none focus:ring-2 focus:ring-indigo-500 text-3xl font-black text-center tracking-[0.6em]"/>
              </div>
              <motion.button whileTap={{scale:0.97}} onClick={handleJoin} disabled={loading} className="w-full py-4 bg-gradient-to-r from-emerald-600 to-teal-600 disabled:opacity-50 text-white font-black rounded-xl text-lg shadow-xl transition-all">{loading?"Joining...":"Join Room 🎮"}</motion.button>
            </div>
          )}
          {error&&<motion.p initial={{opacity:0}} animate={{opacity:1}} className="mt-3 text-red-400 text-sm text-center font-semibold">⚠️ {error}</motion.p>}
        </div>
        <p className="text-center text-white/20 text-xs mt-5">Match synonyms • Play wildcards • First to 0 cards wins!</p>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMILY PICKER — host selects 4 families (random or manual)
// ─────────────────────────────────────────────────────────────────────────────
function FamilyPickerScreen({ roomCode, playerId, isHost, roomState, onFamiliesChosen, onExit }) {
  const [pickMode, setPickMode] = useState(null); // null | "random" | "manual"
  const [selected, setSelected] = useState([]);

  // Non-host: listen for game start
  useEffect(()=>{
    if(isHost) return;
    const ch = supabase.channel(`picker-${roomCode}`)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"rooms",filter:`id=eq.${roomCode}`},(payload)=>{
        const gs = payload.new.game_state;
        if(gs.phase==="playing") onFamiliesChosen(null, gs); // signal to parent
      }).subscribe();
    return()=>supabase.removeChannel(ch);
  },[roomCode, isHost]);

  const handleRandom = () => {
    const picked = shuffle(ALL_FAMILIES).slice(0,4).map(f=>f.id);
    onFamiliesChosen(picked);
  };

  const toggleFamily = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x=>x!==id) : prev.length<4 ? [...prev,id] : prev);
  };

  const players = roomState?.players || [];

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-start p-4 overflow-y-auto">
      <div className="w-full max-w-md mt-4">
        <div className="text-center mb-5">
          <h2 className="text-2xl font-black text-white">Choose Families</h2>
          <div className="mt-2 inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-1.5">
            <span className="text-white/50 text-sm">Room:</span>
            <span className="text-2xl font-black text-amber-400 tracking-widest">{roomCode}</span>
          </div>
          <p className="text-white/30 text-xs mt-1">{players.length} player{players.length!==1?"s":""} in room</p>
        </div>

        {isHost ? (
          !pickMode ? (
            <div className="space-y-3">
              <p className="text-white/60 text-sm text-center mb-4">How do you want to choose the 4 connector families for this game?</p>
              <motion.button whileTap={{scale:0.97}} onClick={handleRandom} className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black rounded-xl text-base shadow-xl">
                🎲 Random — Surprise me!
              </motion.button>
              <motion.button whileTap={{scale:0.97}} onClick={()=>setPickMode("manual")} className="w-full py-4 bg-white/5 border border-white/15 text-white font-black rounded-xl text-base hover:bg-white/10 transition-all">
                🖐 Manual — I'll choose
              </motion.button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-white/60 text-sm">Select exactly <span className="text-white font-bold">4 families</span></p>
                <span className={`text-sm font-black px-3 py-1 rounded-full ${selected.length===4?"bg-emerald-500/20 text-emerald-400":"bg-white/5 text-white/40"}`}>{selected.length}/4</span>
              </div>
              <div className="space-y-2 mb-4">
                {ALL_FAMILIES.map(fam=>{
                  const cfg=COLOR_CFG[fam.color];
                  const isSel=selected.includes(fam.id);
                  const isDisabled=!isSel&&selected.length>=4;
                  return (
                    <motion.button key={fam.id} whileTap={{scale:0.98}} onClick={()=>toggleFamily(fam.id)} disabled={isDisabled}
                      className={`w-full rounded-xl p-3 text-left border transition-all ${isSel?`bg-gradient-to-r ${cfg.bg} border-transparent`:"bg-white/[0.03] border-white/10"} ${isDisabled?"opacity-30 cursor-not-allowed":""}`}>
                      <div className="flex items-center justify-between">
                        <span className={`font-black text-sm ${isSel?"text-white":"text-white/80"}`}>{fam.label}</span>
                        {isSel&&<span className="text-white text-xs">✓</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {fam.variants.map(v=><span key={v} className={`text-[10px] px-1.5 py-0.5 rounded ${isSel?"bg-black/20 text-white/70":"bg-white/5 text-white/30"}`}>{v}</span>)}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setPickMode(null)} className="flex-1 py-3 bg-white/5 text-white/50 font-bold rounded-xl text-sm hover:bg-white/10 transition-all">← Back</button>
                <motion.button whileTap={{scale:0.97}} onClick={()=>onFamiliesChosen(selected)} disabled={selected.length!==4} className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 disabled:opacity-30 disabled:cursor-not-allowed text-white font-black rounded-xl text-sm shadow-xl transition-all">
                  {selected.length===4 ? "Start Game! 🎮" : `Select ${4-selected.length} more`}
                </motion.button>
              </div>
            </div>
          )
        ) : (
          <div className="text-center py-8">
            <motion.div animate={{opacity:[0.5,1,0.5]}} transition={{duration:1.5,repeat:Infinity}} className="text-white/50 font-medium">
              Waiting for host to select families...
            </motion.div>
          </div>
        )}

        <button onClick={onExit} className="w-full mt-4 py-3 text-white/30 hover:text-white/60 text-sm font-medium transition-colors">Leave Room</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WAITING ROOM
// ─────────────────────────────────────────────────────────────────────────────
function WaitingRoom({ roomCode, playerId, isHost, onProceed, onExit }) {
  const [roomState, setRoomState] = useState(null);

  useEffect(()=>{
    supabase.from("rooms").select("*").eq("id",roomCode).single().then(({data})=>{ if(data) setRoomState(data.game_state); });
    const ch = supabase.channel(`room-wait-${roomCode}`)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"rooms",filter:`id=eq.${roomCode}`},(payload)=>{
        const gs=payload.new.game_state;
        setRoomState(gs);
        if(gs.phase==="picking") onProceed(gs);
        if(gs.phase==="playing") onProceed(gs);
      }).subscribe();
    return()=>supabase.removeChannel(ch);
  },[roomCode,onProceed]);

  const handleNext = async () => {
    if(!roomState||roomState.players.length<2) return;
    const newGs = {...roomState, phase:"picking"};
    await supabase.from("rooms").update({game_state:newGs, updated_at:new Date().toISOString()}).eq("id",roomCode);
    // Host navigates directly — realtime won't fire for the writer
    onProceed(newGs);
  };

  const players=roomState?.players||[], maxPlayers=roomState?.maxPlayers||4;
  const canStart=isHost&&players.length>=2;

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-black text-white">Waiting Room</h2>
          <div className="mt-3 inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-5 py-2">
            <span className="text-white/50 text-sm">Room Code:</span>
            <span className="text-3xl font-black text-amber-400 tracking-widest">{roomCode}</span>
          </div>
          <p className="text-white/40 text-sm mt-2">Share this code with your friends!</p>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-3xl p-6 mb-4">
          <div className="flex items-center justify-between mb-4"><span className="text-white font-bold">Players</span><span className="text-white/40 text-sm">{players.length} / {maxPlayers}</span></div>
          <div className="space-y-2">
            {players.map((p,i)=>(
              <motion.div key={p.id} initial={{opacity:0,x:-20}} animate={{opacity:1,x:0}} transition={{delay:i*0.1}} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-sm">{p.name[0].toUpperCase()}</div>
                <span className="text-white font-semibold">{p.name}</span>
                {p.id===roomState?.hostId&&<span className="ml-auto text-amber-400 text-xs font-bold bg-amber-400/10 px-2 py-0.5 rounded-full">HOST</span>}
                {p.id===playerId&&<span className="ml-auto text-emerald-400 text-xs font-bold bg-emerald-400/10 px-2 py-0.5 rounded-full">YOU</span>}
              </motion.div>
            ))}
            {[...Array(Math.max(0,maxPlayers-players.length))].map((_,i)=>(
              <div key={i} className="flex items-center gap-3 bg-white/[0.02] border border-dashed border-white/10 rounded-xl px-4 py-3">
                <div className="w-8 h-8 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center"><span className="text-white/20 text-sm">?</span></div>
                <span className="text-white/20 text-sm">Waiting for player...</span>
              </div>
            ))}
          </div>
        </div>
        {isHost?(
          <motion.button whileTap={{scale:0.97}} onClick={handleNext} disabled={!canStart} className={`w-full py-4 font-black rounded-xl text-lg transition-all ${canStart?"bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xl":"bg-white/5 text-white/30 cursor-not-allowed"}`}>
            {canStart?"Next — Choose Families →":`Need at least 2 players (${players.length}/2)`}
          </motion.button>
        ):(
          <div className="text-center py-4"><motion.div animate={{opacity:[0.5,1,0.5]}} transition={{duration:1.5,repeat:Infinity}} className="text-white/50 font-medium">Waiting for host...</motion.div></div>
        )}
        <button onClick={onExit} className="w-full mt-3 py-3 text-white/30 hover:text-white/60 text-sm font-medium transition-colors">Leave Room</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME TABLE
// ─────────────────────────────────────────────────────────────────────────────
const GAME_DURATION = 15 * 60 * 1000; // 15 min in ms

function GameTable({ roomCode, playerId, initialGameState, onExit }) {
  const [game, setGame] = useState(initialGameState.gameData);
  const [toasts, setToasts] = useState([]);
  const [showWildPicker, setShowWildPicker] = useState(false);
  const [pendingWild, setPendingWild] = useState(null);
  const [celebrate, setCelebrate] = useState(false);
  const [totem, setTotem] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const prevTurnRef = useRef(null);
  const prevHandRef = useRef(null);
  const timeUpRef = useRef(false);

  const addToast = useCallback((msg, type="info")=>{
    const id=Date.now()+Math.random();
    setToasts(p=>[...p,{id,message:msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3000);
  },[]);

  // Realtime
  useEffect(()=>{
    const ch=supabase.channel(`game-${roomCode}`)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"rooms",filter:`id=eq.${roomCode}`},(payload)=>{
        const gs=payload.new.game_state;
        if(gs.gameData) setGame(gs.gameData);
      }).subscribe();
    return()=>supabase.removeChannel(ch);
  },[roomCode]);

  const myPlayerIdx = useMemo(()=>game?.players.findIndex(p=>p.id===playerId)??-1,[game,playerId]);
  const isMyTurn = useMemo(()=>game&&!game.winner&&!game.timeUp&&!game.stalemate&&game.currentPlayerIdx===myPlayerIdx,[game,myPlayerIdx]);
  const activeFamilies = useMemo(()=>ALL_FAMILIES.filter(f=>game?.selectedFamilyIds?.includes(f.id)),[game]);

  // Timer: check if time is up (only the current player's client triggers it when their turn ends)
  useEffect(()=>{
    if(!game||game.winner||game.timeUp) return;
    const check=()=>{
      const elapsed=Date.now()-game.startedAt;
      if(elapsed>=GAME_DURATION && !timeUpRef.current && !isMyTurn) {
        // Time's up but we wait for current turn to finish — handled in applyPlay/handleDrawCard
      }
    };
    const id=setInterval(check,1000);
    return()=>clearInterval(id);
  },[game,isMyTurn]);

  // Totem on turn change
  useEffect(()=>{
    if(!game) return;
    const cur=game.currentPlayerIdx;
    if(prevTurnRef.current!==null&&prevTurnRef.current!==cur&&cur===myPlayerIdx&&!game.winner&&!game.timeUp){
      const cnt=(game.hands[playerId]||[]).length;
      const prev=prevHandRef.current??cnt;
      if(cnt>=prev+4){ setTotem("draw4"); Sounds.draw4(); }
      else { setTotem("your_turn"); Sounds.turn(); }
    }
    prevTurnRef.current=cur;
    prevHandRef.current=(game.hands[playerId]||[]).length;
  },[game?.currentPlayerIdx,game?.winner,game?.timeUp]);

  useEffect(()=>{ if(game?.winner){ setCelebrate(true); Sounds.win(); setTimeout(()=>setCelebrate(false),5000); } },[game?.winner]);
  useEffect(()=>{ if(game?.timeUp || game?.stalemate){ setShowResults(true); } },[game?.timeUp, game?.stalemate]);

  const push = useCallback(async(gd)=>{
    await supabase.from("rooms").update({game_state:{...initialGameState,gameData:gd},updated_at:new Date().toISOString()}).eq("id",roomCode);
  },[roomCode,initialGameState]);

  const maybeEndByTime = useCallback((g)=>{
    const elapsed=Date.now()-g.startedAt;
    if(elapsed>=GAME_DURATION && !g.winner && !g.timeUp && !g.stalemate){
      g.timeUp=true;
    }
    return g;
  },[]);

  const handlePlayCard = useCallback((card)=>{
    if(!game||!isMyTurn) return;
    const topCard=game.discardPile[game.discardPile.length-1];
    if(!canPlay(card,topCard,game.currentFamily)){
      Sounds.error();
      const ng=JSON.parse(JSON.stringify(game));
      if(ng.drawPile.length>0) ng.hands[playerId].push(ng.drawPile.pop());
      ng.lastAction=`${game.players[myPlayerIdx].name} played invalid — drew 1`;
      setGame(ng); push(ng);
      return;
    }
    if(card.type==="wildcard"&&card.wildcard==="change_connector"){ setPendingWild(card); setShowWildPicker(true); return; }
    applyPlay(card, game.currentFamily);
  },[game,isMyTurn,playerId,myPlayerIdx]);

  const applyPlay = useCallback((card, chosenFamily)=>{
    Sounds.play();
    setGame(prev=>{
      if(!prev) return prev;
      const g=JSON.parse(JSON.stringify(prev));
      g.hands[playerId]=g.hands[playerId].filter(c=>c.id!==card.id);
      g.discardPile.push(card);
      g.consecutiveUselessDraws={...g.consecutiveUselessDraws,[playerId]:0};
      g.cardsPlayed={...g.cardsPlayed,[playerId]:(g.cardsPlayed[playerId]||0)+1};
      let newFamily=chosenFamily;
      const total=g.players.length;
      let nextIdx=(g.currentPlayerIdx+g.direction+total)%total;
      if(card.type==="wildcard"){
        if(card.wildcard==="draw_2"){
          const nid=g.players[nextIdx].id;
          const cnt=Math.min(2,g.drawPile.length);
          for(let i=0;i<cnt;i++) g.hands[nid].push(g.drawPile.pop());
          addToast(`${g.players[nextIdx].name} draws 2!`,"warning");
          nextIdx=(nextIdx+g.direction+total)%total;
        } else if(card.wildcard==="draw_4"){
          const nid=g.players[nextIdx].id;
          const cnt=Math.min(4,g.drawPile.length);
          for(let i=0;i<cnt;i++) g.hands[nid].push(g.drawPile.pop());
          addToast(`${g.players[nextIdx].name} draws 4! 💀`,"warning");
          nextIdx=(nextIdx+g.direction+total)%total;
        }
      } else { newFamily=card.familyId; }
      g.currentFamily=newFamily;
      g.currentPlayerIdx=nextIdx;
      g.lastAction=`Played: ${card.connector||card.wildcard}`;
      if(g.hands[playerId].length===0) g.winner={id:playerId,name:g.players[myPlayerIdx].name};
      const final=maybeEndByTime(g);
      push(final);
      return final;
    });
  },[playerId,myPlayerIdx,addToast,push,maybeEndByTime]);

  const handleDrawCard = useCallback(()=>{
    if(!game||!isMyTurn) return;
    // Draw pile empty and player has no playable card → skip turn
    if(game.drawPile.length===0){
      const topCard=game.discardPile[game.discardPile.length-1];
      const stuck=!(game.hands[playerId]||[]).some(c=>canPlay(c,topCard,game.currentFamily));
      if(!stuck) return; // has playable cards, just can't draw
      const ng=JSON.parse(JSON.stringify(game));
      const total=ng.players.length;
      ng.currentPlayerIdx=(ng.currentPlayerIdx+ng.direction+total)%total;
      ng.lastAction=`${ng.players[myPlayerIdx].name} is stuck — turn skipped!`;
      // Check stalemate
      if(checkStalemate(ng)){
        ng.stalemate=true;
      }
      const final=maybeEndByTime(ng);
      setGame(final); push(final);
      return;
    }
    Sounds.draw();
    const ng=JSON.parse(JSON.stringify(game));
    const topCard=ng.discardPile[ng.discardPile.length-1];
    const useless=ng.consecutiveUselessDraws?.[playerId]??0;
    let mercyGiven=false;
    if(useless>=2){
      // Mercy: only give a draw_4 or change_connector wildcard
      const mercyIdx = ng.drawPile.findIndex(c => c.type==="wildcard" && (c.wildcard==="draw_4"||c.wildcard==="change_connector"));
      if(mercyIdx!==-1){
        const mc = ng.drawPile.splice(mercyIdx,1)[0];
        ng.hands[playerId].push(mc);
        ng.consecutiveUselessDraws={...ng.consecutiveUselessDraws,[playerId]:0};
        setTotem("mercy"); Sounds.mercy();
        ng.lastAction="Mercy card granted!";
        setGame(ng); push(ng); return;
      }
      // No mercy card available — fall through to normal draw
    }
    if(!mercyGiven){
      const drawn=ng.drawPile.pop();
      ng.hands[playerId].push(drawn);
      const playable=canPlay(drawn,topCard,ng.currentFamily);
      ng.consecutiveUselessDraws={...ng.consecutiveUselessDraws,[playerId]:playable?0:(useless+1)};
    }
    const total=ng.players.length;
    ng.currentPlayerIdx=(ng.currentPlayerIdx+ng.direction+total)%total;
    ng.lastAction=`${ng.players[myPlayerIdx].name} drew a card`;
    const final=maybeEndByTime(ng);
    setGame(final); push(final);
  },[game,isMyTurn,playerId,myPlayerIdx,push,maybeEndByTime]);

  const handleWildPick=useCallback((familyId)=>{ setShowWildPicker(false); if(pendingWild){ applyPlay(pendingWild,familyId); setPendingWild(null); } },[pendingWild,applyPlay]);

  if(!game) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center"><motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}} className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full"/></div>;

  const myHand=game.hands[playerId]||[];
  const topCard=game.discardPile[game.discardPile.length-1];
  const currentFamilyData=activeFamilies.find(f=>f.id===game.currentFamily);
  const currentPlayerName=game.players[game.currentPlayerIdx]?.name||"";

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col overflow-hidden" style={{background:"radial-gradient(ellipse at top,#0f0f2e 0%,#0a0a0f 60%)"}}>
      <CelebrationParticles active={celebrate}/>
      <AnimatePresence>{totem&&<TotemOverlay type={totem} onDone={()=>setTotem(null)}/>}</AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/40 backdrop-blur border-b border-white/5">
        <button onClick={onExit} className="text-white/40 hover:text-white/70 text-xs font-medium transition-colors">← Exit</button>
        <div className="text-center">
          <span className="text-white font-black text-sm">Connector <span className="text-amber-400">Master</span></span>
          <div className="text-white/30 text-[10px]">Room {roomCode}</div>
        </div>
        <div className="flex items-center gap-2">
          <TimerDisplay startedAt={game.startedAt} duration={GAME_DURATION/1000}/>
          <div className="text-right">
            <div className="text-white/40 text-[9px]">Draw</div>
            <div className="text-white font-bold text-xs">{game.drawPile.length}</div>
          </div>
        </div>
      </div>

      {/* Opponents */}
      <div className="flex flex-col gap-1 px-2 pt-1">
        {game.players.filter(p=>p.id!==playerId).map(player=>{
          const pIdx=game.players.findIndex(p=>p.id===player.id);
          const isCur=game.currentPlayerIdx===pIdx;
          const cnt=(game.hands[player.id]||[]).length;
          return (
            <div key={player.id} className={`flex items-center gap-1.5 rounded-xl px-2 py-1 border transition-all ${isCur?"bg-amber-500/15 border-amber-400/50":"bg-white/[0.03] border-white/[0.06]"}`}>
              <div className="flex flex-col items-center min-w-[44px]">
                <span className="text-white text-[10px] font-bold truncate max-w-[44px]">{player.name}</span>
                <span className={`text-[9px] font-black px-1 rounded ${isCur?"text-amber-300":"text-white/30"}`}>{cnt}🂠</span>
              </div>
              <div className="flex overflow-hidden flex-1" style={{maxWidth:"calc(100vw - 100px)"}}>
                {[...Array(Math.min(cnt,16))].map((_,i)=><div key={i} style={{marginLeft:i>0?(cnt>8?"-10px":"-4px"):0}}><CardFace card={{}} faceDown small/></div>)}
                {cnt>16&&<span className="text-white/40 text-[10px] self-center ml-1">+{cnt-16}</span>}
              </div>
              {isCur&&<motion.span animate={{scale:[1,1.3,1]}} transition={{duration:0.7,repeat:Infinity}} className="text-amber-400 text-sm ml-auto">▶</motion.span>}
            </div>
          );
        })}
      </div>

      {/* Game Center */}
      <div className="flex flex-col items-center justify-center gap-2 py-2 px-4">
        {currentFamilyData&&(
          <motion.div key={game.currentFamily} initial={{opacity:0,scale:0.8}} animate={{opacity:1,scale:1}} className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${COLOR_CFG[currentFamilyData.color]?.badge}`}>
            {currentFamilyData.label}
          </motion.div>
        )}
        <div className="flex items-center gap-8">
          <motion.button whileTap={{scale:0.92}} onClick={handleDrawCard} disabled={!isMyTurn} className="relative">
            <CardFace card={{}} faceDown/>
            <div className="absolute -top-2 -right-2 bg-indigo-600 text-white text-xs font-black rounded-full w-6 h-6 flex items-center justify-center shadow-lg">{game.drawPile.length}</div>
            {isMyTurn&&<motion.div animate={{opacity:[0.3,1,0.3]}} transition={{duration:1.5,repeat:Infinity}} className="absolute inset-0 rounded-xl ring-2 ring-white/50 ring-offset-2 ring-offset-black"/>}
          </motion.button>
          <AnimatePresence mode="popLayout">
            <motion.div key={topCard.id} initial={{scale:0.4,opacity:0,y:-80,rotate:-20}} animate={{scale:1,opacity:1,y:0,rotate:0}} transition={{type:"spring",stiffness:280,damping:22}}>
              <CardFace card={topCard}/>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className={`text-xs font-bold px-4 py-1.5 rounded-full border transition-all ${isMyTurn?"bg-emerald-500/15 text-emerald-300 border-emerald-500/40":"bg-white/[0.03] text-white/40 border-white/[0.08]"}`}>
          {isMyTurn?"🟢 Your Turn — Play or Draw!":`⏳ ${currentPlayerName}'s turn`}
        </div>
        {game.lastAction&&<p className="text-white/20 text-[10px] italic text-center">{game.lastAction}</p>}
      </div>

      {/* Hand Carousel */}
      <HandCarousel myHand={myHand} handlePlayCard={handlePlayCard} isMyTurn={isMyTurn}/>

      {/* Toasts */}
      <div className="fixed bottom-36 left-0 right-0 flex flex-col items-center gap-2 z-30 pointer-events-none px-4">
        <AnimatePresence>{toasts.map(t=><Toast key={t.id} message={t.message} type={t.type}/>)}</AnimatePresence>
      </div>

      {/* Winner modal */}
      <AnimatePresence>
        {game.winner&&(
          <motion.div initial={{opacity:0}} animate={{opacity:1}} className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{scale:0.5,y:80}} animate={{scale:1,y:0}} transition={{type:"spring",stiffness:240,damping:20}} className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-3xl p-8 text-center max-w-sm w-full shadow-2xl">
              <div className="text-7xl mb-3">🏆</div>
              <h2 className="text-3xl font-black text-white mb-1">{game.winner.id===playerId?"You Won!":`${game.winner.name} Won!`}</h2>
              <p className="text-amber-100 text-sm mb-6">{game.winner.id===playerId?"Amazing! You connected all the way!":"Good game! Keep practicing!"}</p>
              <button onClick={onExit} className="px-6 py-3 bg-white text-amber-700 rounded-xl font-black text-sm">Back to Lobby</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time's up — Results */}
      <AnimatePresence>
        {showResults&&<ResultsScreen game={game} playerId={playerId} onExit={onExit}/>}
      </AnimatePresence>

      {/* Wildcard picker */}
      <AnimatePresence>
        {showWildPicker&&<WildcardPicker families={activeFamilies} onPick={handleWildPick} onClose={()=>{setShowWildPicker(false);setPendingWild(null);}}/>}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────────────────────
export default function ConnectorMaster() {
  const [screen, setScreen] = useState("lobby"); // lobby | waiting | picking | game
  const [roomInfo, setRoomInfo] = useState(null);
  const [roomState, setRoomState] = useState(null);
  const [gameState, setGameState] = useState(null);

  const handleEnterRoom = (info) => { setRoomInfo(info); setScreen("waiting"); };

  const handleProceed = (gs) => {
    setRoomState(gs);
    if(gs.phase==="picking") setScreen("picking");
    if(gs.phase==="playing") { setGameState(gs); setScreen("game"); }
  };

  const handleFamiliesChosen = async (selectedFamilyIds, directGs=null) => {
    // Non-host: game already started, just navigate
    if(directGs) {
      setGameState(directGs);
      setScreen("game");
      return;
    }
    // Host: build game state and push
    const { data } = await supabase.from("rooms").select("*").eq("id",roomInfo.roomCode).single();
    const gs = data?.game_state || roomState;
    const gameData = initGameState(gs.players, selectedFamilyIds);
    const newGs = {...gs, phase:"playing", gameData};
    await supabase.from("rooms").update({
      game_state: newGs,
      updated_at: new Date().toISOString(),
    }).eq("id",roomInfo.roomCode);
    setGameState(newGs);
    setScreen("game");
  };

  const handleExit = async () => {
    if(roomInfo){
      const { data } = await supabase.from("rooms").select("*").eq("id",roomInfo.roomCode).single();
      if(data){
        const gs=data.game_state;
        if(gs.phase==="lobby"||gs.phase==="picking"){
          const up=gs.players.filter(p=>p.id!==roomInfo.playerId);
          if(up.length===0) await supabase.from("rooms").delete().eq("id",roomInfo.roomCode);
          else await supabase.from("rooms").update({game_state:{...gs,players:up,hostId:up[0].id},updated_at:new Date().toISOString()}).eq("id",roomInfo.roomCode);
        }
      }
    }
    setScreen("lobby"); setRoomInfo(null); setRoomState(null); setGameState(null);
  };

  if(screen==="lobby") return <LobbyScreen onEnterRoom={handleEnterRoom}/>;
  if(screen==="waiting") return <WaitingRoom roomCode={roomInfo.roomCode} playerId={roomInfo.playerId} isHost={roomInfo.isHost} onProceed={handleProceed} onExit={handleExit}/>;
  if(screen==="picking") return <FamilyPickerScreen roomCode={roomInfo.roomCode} playerId={roomInfo.playerId} isHost={roomInfo.isHost} roomState={roomState} onFamiliesChosen={handleFamiliesChosen} onExit={handleExit}/>;
  if(screen==="game") return <GameTable roomCode={roomInfo.roomCode} playerId={roomInfo.playerId} initialGameState={gameState} onExit={handleExit}/>;
}