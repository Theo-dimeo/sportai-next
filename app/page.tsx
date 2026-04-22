'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdBanner from '@/components/AdBanner';
import type { Match, Prediction, BetEntry, MatchOddsData } from '@/lib/types';
import { COMPETITIONS, BOOKMAKERS } from '@/lib/types';
import { kellyStake } from '@/lib/predictor';
import { matchOddsToMatch } from '@/lib/parser';

const DAYS = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const DAYS_SHORT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

// Retourne YYYY-MM-DD en heure de Paris
function parisDayISO(d: Date = new Date()): string {
  return d.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).split('/').reverse().join('-');
}

// Retourne une Date représentant le jour J dans le fuseau Paris
function addDays(base: string, n: number): string {
  const d = new Date(base + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return parisDayISO(d);
}

const fmtFull = (iso: string) => {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
const fmtDayLabel = (isoDay: string) => {
  const d = new Date(isoDay + 'T12:00:00Z');
  const today = parisDayISO();
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  if (isoDay === today) return { top: "Aujourd'hui", bot: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`, isToday: true };
  if (isoDay === tomorrow) return { top: 'Demain', bot: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`, isToday: false };
  if (isoDay === yesterday) return { top: 'Hier', bot: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`, isToday: false };
  return { top: DAYS_SHORT[d.getUTCDay()], bot: `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`, isToday: false };
};
const cc = (c: number) => c >= 70 ? '#00e676' : c >= 55 ? '#ffd700' : '#ff4b4b';

function statusInfo(s: string, min: number | null) {
  const M: Record<string,{l:string,c:string}> = {
    SCHEDULED:{l:'Programmé',c:'#4a5568'}, TIMED:{l:'Programmé',c:'#4a5568'},
    IN_PLAY:{l:`${min??'?'}' ●`,c:'#ff4b4b'}, PAUSED:{l:'Mi-temps',c:'#ff4b4b'},
    FINISHED:{l:'Terminé',c:'#4a5568'}, AWARDED:{l:'Terminé',c:'#4a5568'},
    POSTPONED:{l:'Reporté',c:'#ffd700'}, CANCELLED:{l:'Annulé',c:'#ffd700'},
  };
  return M[s] ?? { l:s, c:'#4a5568' };
}

function Spinner() {
  return <div className='spinner'/>;
}

function RiskBadge({ r }: { r: string }) {
  const labels: Record<string,string> = {low:'Faible',medium:'Modéré',high:'Élevé'};
  const cls = {low:'risk-low',medium:'risk-medium',high:'risk-high'}[r]??'risk-medium';
  return <span className={cls}>{labels[r]}</span>;
}

type MatchWithPred = Match & { prediction?: Prediction | null };

function MatchRow({ match, oddsData, selectedBk, selected, onSelect, onAddTicket }: {
  match: MatchWithPred; oddsData?: MatchOddsData | null; selectedBk: string;
  selected: boolean; onSelect:(m:Match)=>void;
  onAddTicket:(match:Match,pred:Prediction,key:string,bk:string)=>void;
}) {
  const pred = match.prediction;
  const si = statusInfo(match.status, match.minute);
  const isLive = match.isLive; const isDone = match.isDone;
  const bkOdds = oddsData?.bkMap?.[selectedBk]
    ?? (oddsData ? Object.values(oddsData.bkMap)[0] : undefined);
  const isSelectedBk = !!(oddsData?.bkMap?.[selectedBk]);
  const dispOdds = bkOdds ?? pred?.odds;
  const isBest = (k:'home'|'draw'|'away') => {
    if (!oddsData||!bkOdds) return false;
    const v = bkOdds[k];
    return v===(k==='home'?oddsData.bestHome:k==='draw'?oddsData.bestDraw:oddsData.bestAway);
  };
  return (
    <div className={`match-row${selected?' sel':''}${isLive&&!selected?' live-row':''}`}
      onClick={()=>onSelect(match)}>
      <div className='col-time'>
        <div className='time-val'>{match.time}</div>
        <div className='time-date'>{match.date?new Date(match.date).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris',day:'2-digit',month:'2-digit'}):''}</div>
        <div className='time-status' style={{color:si.c,animation:isLive?'pulse 1.5s infinite':'none'}}>{si.l}</div>
      </div>
      <div className='col-team'>
        <div className='team-row'>
          {match.homeTeam.crest&&<img src={match.homeTeam.crest} alt='' className='team-crest' onError={e=>(e.currentTarget.style.display='none')}/>}
          <span className='team-name'>{match.homeTeam.name}</span>
        </div>
      </div>
      <div className='col-mid'>
        {(isLive||isDone)?(
          <>
            <div className={isLive?'score-live':'score-done'}>{match.score.home??'?'} – {match.score.away??'?'}</div>
            {isLive&&<div style={{fontSize:10,color:'var(--red)',fontWeight:600,animation:'pulse 1.5s infinite',fontFamily:'var(--font-mono)'}}>{match.minute}'</div>}
          </>
        ):(
          <>
            <div className='vs-text'>VS</div>
            {pred&&<div className='xg-text'>{pred.xgHome}–{pred.xgAway} xG</div>}
            {pred&&<div className='prob-bar'><div style={{background:'var(--green)',flex:pred.probabilities.home}}/><div style={{background:'var(--text-disabled)',flex:pred.probabilities.draw}}/><div style={{background:'var(--red)',flex:pred.probabilities.away}}/></div>}
          </>
        )}
      </div>
      <div className='col-team right'>
        <div className='team-row'>
          {match.awayTeam.crest&&<img src={match.awayTeam.crest} alt='' className='team-crest' onError={e=>(e.currentTarget.style.display='none')}/>}
          <span className='team-name'>{match.awayTeam.name}</span>
        </div>
      </div>
      <div className='col-pred'>
        {pred&&!isDone?(<><div className='pred-label'>IA</div><div className='pred-val' style={{color:cc(pred.confidence)}}>{pred.prediction}</div><div className='conf-row'><div className='conf-track'><div className='conf-fill' style={{width:pred.confidence+'%',background:cc(pred.confidence)}}/></div><span className='conf-pct' style={{color:cc(pred.confidence)}}>{pred.confidence}%</span></div></>):isDone?<span style={{fontSize:11,color:'var(--text-disabled)'}}>Terminé</span>:<span style={{fontSize:11,color:'var(--text-disabled)'}}>—</span>}
      </div>
      <div className='col-odds' onClick={e=>e.stopPropagation()}>
        {dispOdds&&!isDone?(['home','draw','away'] as const).map((k,i)=>{
          const odd=dispOdds[k]; if(!odd) return null;
          const best=isBest(k); const isPK=pred?.predictionKey===k;
          return <div key={k} className={`odd-btn${best?' best':''}${isPK?' pick':''}`} onClick={()=>pred&&onAddTicket(match,pred,k,bkOdds&&isSelectedBk?selectedBk:bkOdds?.key??'ai')}><div className='odd-label'>{['1','N','2'][i]}</div><div className='odd-val'>{odd}</div></div>;
        }):isDone?<span style={{fontSize:11,color:'var(--text-disabled)',display:'flex',alignItems:'center',fontFamily:'var(--font-mono)'}}>{match.score.home}–{match.score.away}</span>:null}
      </div>
    </div>
  );
}

function MatchDetail({ match, oddsData, solde, selectedBk, onAddTicket }: {
  match: MatchWithPred; oddsData?: MatchOddsData|null; solde:number; selectedBk:string;
  onAddTicket:(match:Match,pred:Prediction,key:string,bk:string)=>void;
}) {
  const pred = match.prediction;
  if (!pred&&!match.isDone) return <div style={{display:'flex',justifyContent:'center',padding:40}}><Spinner/></div>;
  const meta = COMPETITIONS[match.competitionId];
  const si = statusInfo(match.status, match.minute);
  const bkOdds = oddsData?.bkMap?.[selectedBk]
    ?? (oddsData ? Object.values(oddsData.bkMap)[0] : undefined);
  const isSelectedBk = !!(oddsData?.bkMap?.[selectedBk]);
  const dispOdd = bkOdds ?? pred?.odds;
  const predKey = pred?.predictionKey ?? 'home';
  const theOdd = dispOdd?.[predKey];
  const mise = pred&&theOdd ? kellyStake(solde,pred.confidence,theOdd,pred.riskLevel) : null;
  const gain = mise&&theOdd ? (mise*theOdd-mise).toFixed(2) : null;
  const bkName = bkOdds ? (BOOKMAKERS.find(b=>b.key===(isSelectedBk?selectedBk:bkOdds.key))?.name??bkOdds.name??selectedBk) : 'Modèle IA';
  const sec: React.CSSProperties = {padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,.055)'};
  const stl: React.CSSProperties = {fontSize:10,color:'#4a5568',textTransform:'uppercase',letterSpacing:.8,fontWeight:700,marginBottom:12};
  const bkRows = oddsData ? Object.values(oddsData.bkMap) : [];

  return (
    <div className='detail-panel'>
      {/* HERO */}
      <div className='detail-hero'>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12,flexWrap:'wrap'}}>
          <span style={{fontSize:10,color:'#4a5568',textTransform:'uppercase',letterSpacing:.8,fontWeight:700}}>{meta?.flag} {match.competition}</span>
          <span style={{color:'#4a5568'}}>·</span>
          <span style={{fontSize:10,color:si.c,fontWeight:700}}>{si.l}</span>
          <span style={{background:'rgba(0,230,118,.08)',color:'#00e676',border:'1px solid rgba(0,230,118,.2)',borderRadius:20,fontSize:10,fontWeight:700,padding:'2px 8px'}}>● Données réelles</span>
        </div>
        <div className='detail-teams-grid'>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              {match.homeTeam.crest&&<img src={match.homeTeam.crest} alt="" style={{width:30,height:30,objectFit:'contain'}} onError={e=>(e.currentTarget.style.display='none')}/>}
              <span className='detail-team-name'>{match.homeTeam.name}</span>
            </div>
            <div style={{fontSize:10,color:'var(--text-disabled)',marginTop:4,fontFamily:'var(--font-mono)',letterSpacing:'.04em',textTransform:'uppercase'}}>Domicile</div>
          </div>
          <div style={{textAlign:'center'}}>
            {(match.isLive||match.isDone)?(
              <>
                <div className='detail-score' style={{color:match.isDone?'var(--text-primary)':'var(--red)'}}>{match.score.home??'?'} – {match.score.away??'?'}</div>
                <div style={{fontSize:11,color:match.isDone?'var(--text-disabled)':'var(--red)',marginTop:4,fontFamily:'var(--font-mono)'}}>{match.isDone?'Terminé':`● ${match.minute}'`}</div>
              </>
            ):(
              <>
                <div style={{fontFamily:'var(--font-mono)',fontSize:26,fontWeight:500,color:'var(--text-tertiary)',letterSpacing:'-.02em'}}>{match.time}</div>
                <div style={{fontSize:11,color:'var(--text-disabled)',marginTop:3,fontFamily:'var(--font-mono)'}}>{match.date?fmtFull(match.date):''}</div>
                {pred&&<div style={{fontSize:10,color:'#4a5568',marginTop:4}}>xG: {pred.xgHome} – {pred.xgAway}</div>}
              </>
            )}
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end'}}>
              <span className='detail-team-name'>{match.awayTeam.name}</span>
              {match.awayTeam.crest&&<img src={match.awayTeam.crest} alt="" style={{width:30,height:30,objectFit:'contain'}} onError={e=>(e.currentTarget.style.display='none')}/>}
            </div>
            <div style={{fontSize:11,color:'#4a5568',marginTop:4}}>✈️ Extérieur</div>
          </div>
        </div>
        {pred&&!match.isDone&&(
          <div className='pred-box'>
            <div style={{flex:1,minWidth:180}}>
              <div className='pred-box-label'>Prédiction IA</div>
              <div className='pred-box-value'>{pred.prediction}</div>
              <div style={{display:'flex',alignItems:'center',gap:8,marginTop:7,flexWrap:'wrap'}}>
                <RiskBadge r={pred.riskLevel}/>
                <span style={{fontSize:11,color:'#8b9ab5'}}>Cote via {bkName}</span>
              </div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontFamily:'Barlow Condensed',fontSize:40,fontWeight:900,color:cc(pred.confidence),lineHeight:1}}>{pred.confidence}%</div>
              <div style={{fontSize:11,color:'#8b9ab5'}}>confiance</div>
            </div>
            {mise?(
              <div className='mise-box'>
                <div className='mise-box-label'>Kelly ¼</div>
                <div className='mise-box-val'>{mise}€</div>
                <div className='mise-box-sub'>+{gain}€ estimé</div>
                <button className='mise-btn' onClick={()=>onAddTicket(match,pred,predKey,bkOdds?(isSelectedBk?selectedBk:bkOdds.key):'ai')}>+ Ticket</button>
              </div>
            ):(
              <div style={{fontSize:11,color:'var(--text-disabled)',textAlign:'center',minWidth:110,fontFamily:'var(--font-mono)'}}>Solde non défini</div>
            )}
          </div>
        )}
      </div>

      <div className='detail-grid'>
        {pred&&!match.isDone&&(<>
          {/* Probabilités */}
          <div className='detail-sec'>
            <div className='detail-sec-title'>Probabilités</div>
            {(['home','draw','away'] as const).map((k,_i)=>{
              const labels:{[key:string]:string}={home:match.homeTeam.name,draw:'Match nul',away:match.awayTeam.name};
              const colors:{[key:string]:string}={home:'#00e676',draw:'#8b9ab5',away:'#ff4b4b'};
              return <div key={k} style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                <div style={{fontSize:12,color:'#8b9ab5',minWidth:105,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{labels[k]}</div>
                <div style={{flex:1,height:6,background:'#1e2636',borderRadius:3,overflow:'hidden'}}>
                  <div style={{height:'100%',borderRadius:3,background:colors[k],width:pred.probabilities[k]+'%',transition:'width .5s'}}/>
                </div>
                <div style={{fontFamily:'Barlow Condensed',fontSize:14,fontWeight:700,color:colors[k],minWidth:40,textAlign:'right'}}>{pred.probabilities[k]}%</div>
                <div style={{fontSize:11,color:'#4a5568',minWidth:34,textAlign:'right'}}>{pred.odds[k]}</div>
              </div>;
            })}
          </div>
          {/* Paris secondaires */}
          <div style={sec}>
            <div className='detail-sec-title'>Paris secondaires</div>
            {(pred.bets??[]).filter((b: {category:string})=>b.category==='value'||b.category==='safe').slice(0,3).map((b: {label:string,prob:number,odds:number,risk:string,tag:string,emoji:string},i: number)=>{
              const m2=kellyStake(solde,b.prob,b.odds,b.risk);
              return <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#0a0d12',border:'1px solid rgba(255,255,255,.055)',borderRadius:8,padding:'10px 12px',marginBottom:7}}>
                <div>
                  <div style={{fontSize:13,color:'#fff',fontWeight:500}}>{b.emoji} {b.label}</div>
                  <div style={{fontSize:11,color:'#8b9ab5',marginTop:2}}>{b.prob}% probabilité{m2?` · Mise: ${m2}€`:''}</div>
                </div>
                <div style={{fontFamily:'Barlow Condensed',fontSize:22,fontWeight:800,color:'#ffd700'}}>{b.odds}</div>
              </div>;
            })}
          </div>
        </>)}

        {/* Tableau cotes bookmakers */}
        <div className='detail-sec full'>
          <div className='detail-sec-title'>
            Comparaison des cotes par bookmaker
            {bkRows.length>0&&<span className='badge badge-green' style={{marginLeft:8}}>✓ Réelles</span>}
          </div>
          {bkRows.length===0?(
            <div style={{fontSize:13,color:'#4a5568',textAlign:'center',padding:'20px 0'}}>
              Cotes bookmakers non disponibles — ajoutez <code style={{color:'#00e676'}}>ODDS_API_KEY</code> dans Vercel → Settings → Environment Variables
            </div>
          ):(
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead>
                <tr>
                  {['Bookmaker',match.homeTeam.name,'Nul',match.awayTeam.name,...(solde>0?['Mise Kelly','Retour']:[])] .map((h,i)=>(
                    <th key={i} style={{fontSize:10,color:'#4a5568',textTransform:'uppercase',letterSpacing:.6,fontWeight:700,padding:'6px 10px',textAlign:i===0?'left':'right',borderBottom:'1px solid rgba(255,255,255,.055)'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bkRows.sort((a,b)=>(b.home??0)-(a.home??0)).map(bk=>{
                  const isMyBk=bk.key===selectedBk;
                  const m2=pred?kellyStake(solde,pred.confidence,bk[predKey]??pred.odds[predKey],pred.riskLevel):null;
                  const g2=m2&&bk[predKey]?(m2*(bk[predKey]??0)).toFixed(2):null;
                  const emoji=BOOKMAKERS.find(b2=>b2.key===bk.key)?.emoji??'🎰';
                  return <tr key={bk.key} style={{borderBottom:'1px solid rgba(255,255,255,.04)',background:isMyBk?'rgba(255,215,0,.03)':'transparent'}}>
                    <td style={{padding:'8px 10px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <span>{emoji}</span>
                        <span style={{fontWeight:600,color:'#fff'}}>{bk.name}</span>
                        {isMyBk&&<span style={{fontSize:9,color:'#ffd700',border:'1px solid rgba(255,215,0,.3)',borderRadius:3,padding:'1px 5px',fontWeight:700}}>MON BOOK</span>}
                      </div>
                    </td>
                    {(['home','draw','away'] as const).map(k=>{
                      const v=bk[k];
                      const isBestOdd=v!=null&&v===(k==='home'?oddsData?.bestHome:k==='draw'?oddsData?.bestDraw:oddsData?.bestAway);
                      return <td key={k} onClick={()=>pred&&v&&onAddTicket(match,pred,k,bk.key)} style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:16,fontWeight:800,cursor:pred&&v?'pointer':'default',color:isBestOdd?'#00e676':isMyBk?'#ffd700':'#fff',background:isBestOdd?'rgba(0,230,118,.06)':'transparent',borderRadius:5}}>{v??'—'}</td>;
                    })}
                    {solde>0&&<>
                      <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:14,fontWeight:700,color:'#00e676'}}>{m2?`${m2}€`:'—'}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:14,fontWeight:700,color:'#ffd700'}}>{g2?`${g2}€`:'—'}</td>
                    </>}
                  </tr>;
                })}
                {pred&&<tr style={{borderTop:'2px solid rgba(79,142,247,.15)'}}>
                  <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:8}}><span>🤖</span><span style={{color:'#4f8ef7',fontWeight:600}}>Cotes IA</span></div></td>
                  {(['home','draw','away'] as const).map(k=><td key={k} style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:16,fontWeight:800,color:'#4f8ef7'}}>{pred.odds[k]}</td>)}
                  {solde>0&&<>
                    <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:14,fontWeight:700,color:'#00e676'}}>{kellyStake(solde,pred.confidence,pred.odds[predKey],pred.riskLevel)??'—'}€</td>
                    <td style={{padding:'8px 10px',textAlign:'right',fontFamily:'Barlow Condensed',fontSize:14,fontWeight:700,color:'#ffd700'}}>{(()=>{const m2=kellyStake(solde,pred.confidence,pred.odds[predKey],pred.riskLevel);return m2?`${(m2*pred.odds[predKey]).toFixed(2)}€`:'—';})()}</td>
                  </>}
                </tr>}
              </tbody>
            </table>
          )}
        </div>

        {pred&&<div className='detail-sec full'>
          <div className='detail-sec-title'>Raisonnement IA</div>
          <div style={{background:'#0a0d12',borderLeft:'3px solid #4f8ef7',padding:'12px 14px',borderRadius:'0 8px 8px 0',fontSize:13,lineHeight:1.9,color:'#8b9ab5'}}>{pred.reasoning}</div>
        </div>}
      </div>
    </div>
  );
}

interface TicketItem {
  match: Match;
  pred: Prediction;
  key: string;
  odd: number;
  predLabel: string;   // label affiché dans le ticket (ex: "BTTS", "Over 2.5")
  bookmaker: string;
  isCustomOdd?: boolean;
  betId?: string;      // id unique du pari pour éviter les doublons
  aiOdd?: number;      // cote IA originale pour comparaison
}

function Ticket({ items, solde, onRemove, onSubmit, onClose }: {
  items:TicketItem[]; solde:number; onRemove:(i:number)=>void; onSubmit:(mise:number)=>void; onClose:()=>void;
}) {
  if (!items.length) return null;
  const totalOdd = parseFloat(items.reduce((p,i)=>p*i.odd,1).toFixed(2));
  const mise = solde>0?Math.round(Math.min(solde*.04,20)*100)/100:5;
  const gain = (mise*totalOdd).toFixed(2);
  return (
    <div style={{position:'fixed',right:14,bottom:14,background:'#111621',border:'1px solid rgba(255,255,255,.09)',borderRadius:12,width:285,zIndex:90,boxShadow:'0 8px 32px rgba(0,0,0,.55)'}}>
      <div className='ticket-hdr'>
        <span className='ticket-title'>Ticket · {items.length}</span>
        <button className='ticket-close-btn' onClick={onClose}>✕</button>
      </div>
      {items.map((it,i)=>(
        <div key={i} className='ticket-item'>
          <button onClick={()=>onRemove(i)} className='ticket-close-btn' style={{position:'absolute',right:9,top:8,fontSize:13}}>✕</button>
          <div className='ticket-match-label'>{it.match.homeTeam.name} vs {it.match.awayTeam.name} · {it.match.time}</div>
          <div className='ticket-bet-label'>{it.predLabel}</div>
          <div className='ticket-odd-row'>
            <span className='ticket-odd-val'>{it.odd}</span>
            {it.isCustomOdd&&it.aiOdd&&(()=>{
              const diff=Math.round((it.odd/it.aiOdd-1)*100);
              return diff>0
                ? <span style={{fontSize:10,color:'#00e676',background:'rgba(0,230,118,.1)',border:'1px solid rgba(0,230,118,.25)',borderRadius:4,padding:'1px 7px',fontWeight:700}}>+{diff}% value ↑</span>
                : <span style={{fontSize:10,color:'#ff4b4b',background:'rgba(255,75,75,.1)',border:'1px solid rgba(255,75,75,.25)',borderRadius:4,padding:'1px 7px',fontWeight:700}}>{diff}% vs IA</span>;
            })()}
            {it.isCustomOdd&&<span style={{fontSize:10,color:'#ffd700',background:'rgba(255,215,0,.08)',border:'1px solid rgba(255,215,0,.2)',borderRadius:4,padding:'1px 6px',fontWeight:700}}>✏ Cote modifiée</span>}
            {!it.isCustomOdd&&<span style={{fontSize:10,color:'#4a5568'}}>Cote IA</span>}
          </div>
        </div>
      ))}
      <div className='ticket-foot'>
        {[
          ['Cote combinée', String(totalOdd), '#ffd700'],
          ...(solde>0?[['Mise conseillée', `${mise}€`, '#8b9ab5'],['Gain potentiel', `+${gain}€`, '#00e676']]:[] as [string,string,string][]),
        ].map(([l,v,c],i)=>(
          <div key={i} className='ticket-row'><span className='ticket-row-label'>{l}</span><span className={i===0?'ticket-total-odd':'ticket-gain-val'} style={{color:c}}>{v}</span></div>
        ))}
        {items.some(it=>it.isCustomOdd)&&(
          <div style={{fontSize:10,color:'#ffd700',marginBottom:6,padding:'4px 8px',background:'rgba(255,215,0,.06)',borderRadius:5,borderLeft:'2px solid rgba(255,215,0,.4)'}}>
            ✏ Ce ticket contient des cotes personnalisées
          </div>
        )}
        <button onClick={()=>onSubmit(mise)} className='ticket-submit'>
          ✓ Valider le pari ({mise}€)
        </button>
      </div>
    </div>
  );
}

type Tab = 'dashboard'|'bestbets'|'history';

// ─── BEST BETS PANEL ─────────────────────────────────────────
type BetCat = 'safe'|'value'|'combo'|'fun';

const CAT_META: Record<BetCat,{label:string,emoji:string,color:string,bg:string,border:string,desc:string}> = {
  safe:  {label:'Safe',    emoji:'🛡️', color:'#00e676',bg:'rgba(0,230,118,.08)', border:'rgba(0,230,118,.25)',  desc:'Haute probabilité, risque minimal'},
  value: {label:'Valeur',  emoji:'💎', color:'#4f8ef7',bg:'rgba(79,142,247,.08)',border:'rgba(79,142,247,.25)', desc:'Cote intéressante vs probabilité réelle'},
  combo: {label:'Combiné', emoji:'🔗', color:'#ffd700',bg:'rgba(255,215,0,.08)', border:'rgba(255,215,0,.25)',  desc:'Plusieurs critères combinés, cote boostée'},
  fun:   {label:'Fun',     emoji:'🎲', color:'#ff6b35',bg:'rgba(255,107,53,.08)',border:'rgba(255,107,53,.25)', desc:'Audacieux, moins probable mais excitant'},
};
const RISK_COLORS: Record<string,string> = {low:'#00e676',medium:'#ffd700',high:'#ff4b4b'};

// ─── BETCARD ─────────────────────────────────────────────────
// Composant carte de pari avec éditeur de cote intégré
interface BetCardBet {
  id:string; label:string; description:string; emoji:string; tag:string;
  odds:number; prob:number; confidence:number; risk:string; reasoning:string;
  category:string;
  match: MatchWithPred;
  mise: number|null;
  aiOddsOriginal?: number; // cote IA originale (avant remplacement par cote réelle)
  hasRealOdd?: boolean;    // true si la cote affichée vient du bookmaker
  valuePct?: number;       // % écart cote réelle vs IA
}

function BetCard({ bet, catColor, catBg, catBorder, solde, onAddTicket }: {
  bet: BetCardBet;
  catColor: string; catBg: string; catBorder: string;
  solde: number;
  onAddTicket: (match: Match, pred: Prediction, customOdd: number, betLabel: string, betId: string, aiOdd: number) => void;
}) {
  // État local : cote affichée (peut être modifiée par l'utilisateur)
  const [customOdd, setCustomOdd] = useState<number>(bet.odds);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(bet.odds));
  const inputRef = useRef<HTMLInputElement>(null);

  const rc = RISK_COLORS[bet.risk] ?? '#8b9ab5';
  const isModified = customOdd !== bet.odds;

  // Mise et gain recalculés avec la cote personnalisée
  const mise = solde > 0 ? kellyStake(solde, bet.confidence, customOdd, bet.risk) : null;
  const gain = mise ? (mise * customOdd - mise).toFixed(2) : null;

  // Value bet indicator : cote bookmaker > cote IA → value positive
  const valuePct = Math.round((customOdd / bet.odds - 1) * 100);
  const isValue = valuePct > 3;

  const startEdit = () => {
    setInputVal(String(customOdd));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 30);
  };

  const confirmEdit = () => {
    const v = parseFloat(inputVal.replace(',', '.'));
    if (!isNaN(v) && v >= 1.01 && v <= 100) setCustomOdd(parseFloat(v.toFixed(2)));
    else setInputVal(String(customOdd));
    setEditing(false);
  };

  const resetOdd = () => { setCustomOdd(bet.odds); setInputVal(String(bet.odds)); };

  return (
    <div className='bet-card'>

      {/* Header coloré */}
      <div className='bet-card-hdr' style={{background:catBg,borderBottom:`1px solid ${catBorder}`}}>
        <span style={{fontSize:18}}>{bet.emoji}</span>
        <div style={{flex:1}}>
          <div className='bet-card-tag' style={{color:catColor}}>{bet.tag}</div>
          <div className='bet-card-comp'>{bet.match.competition} · {bet.match.time}</div>
        </div>
        {/* COTE ÉDITABLE */}
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:9,color:'#4a5568',marginBottom:2}}>
            {isModified ? '✏ Cote modifiée' : bet.hasRealOdd ? '✓ Cote réelle bookmaker' : 'Cote IA estimée'}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
            {isModified && (
              <button onClick={resetOdd} title="Réinitialiser" style={{background:'none',border:'none',color:'#4a5568',cursor:'pointer',fontSize:13,padding:0,lineHeight:1}}>↩</button>
            )}
            {editing ? (
              <input
                ref={inputRef}
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onBlur={confirmEdit}
                onKeyDown={e => { if(e.key==='Enter') confirmEdit(); if(e.key==='Escape'){setEditing(false);setInputVal(String(customOdd));} }}
  className='odd-edit-input'
              />
            ) : (
              <button onClick={startEdit} title="Modifier la cote" style={{background:'none',border:'none',cursor:'pointer',padding:0}}>
                <div className='bet-card-odd' style={{color:isModified?'var(--text-primary)':catColor,borderBottom:`1px dashed ${catColor}55`,paddingBottom:2}}>
                  {customOdd}
                </div>
              </button>
            )}
          </div>
          {/* Indicateur de value automatique (cote réelle vs IA) ou manuel */}
          {!editing && (()=>{
            const displayPct = isModified ? valuePct : (bet.valuePct ?? 0);
            const showBadge = Math.abs(displayPct) > 2;
            if (!showBadge && !bet.hasRealOdd) return null;
            return (
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2,marginTop:2}}>
                {bet.hasRealOdd && !isModified && <div style={{fontSize:9,color:'#00e676',fontWeight:700}}>✓ Réelle</div>}
                {showBadge && <div style={{fontSize:9,fontWeight:700,color:displayPct>0?'#00e676':'#ff4b4b'}}>{displayPct>0?'+':''}{displayPct}% vs IA</div>}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Match */}
      <div className='bet-card-match'>
        {bet.match.homeTeam.crest && <img src={bet.match.homeTeam.crest} alt="" style={{width:16,height:16,objectFit:'contain'}} onError={e=>(e.currentTarget.style.display='none')}/>}
        <span style={{fontSize:13,color:'#fff',fontWeight:600}}>{bet.match.homeTeam.name}</span>
        <span style={{color:'#4a5568',fontSize:11,fontFamily:'Barlow Condensed',fontWeight:700}}>VS</span>
        {bet.match.awayTeam.crest && <img src={bet.match.awayTeam.crest} alt="" style={{width:16,height:16,objectFit:'contain'}} onError={e=>(e.currentTarget.style.display='none')}/>}
        <span>{bet.match.awayTeam.name}</span>
      </div>

      {/* Corps */}
      <div style={{padding:'12px 14px',flex:1,display:'flex',flexDirection:'column',gap:0}}>
        <div className='bet-card-label'>{bet.label}</div>
        <div className='bet-card-desc'>{bet.description}</div>

        {/* Badges */}
        <div className='bet-card-badges'>
          <span className='badge' style={{background:`${rc}14`,color:rc,boxShadow:`inset 0 0 0 1px ${rc}28`}}>{bet.confidence}%</span>
          <span className='badge badge-muted'>{bet.prob}% prob</span>
          <span className={`risk-${bet.risk}`}>{bet.risk==='low'?'Faible':bet.risk==='medium'?'Modéré':'Élevé'}</span>
        </div>

        {/* Raisonnement */}
        <div className='bet-card-reasoning' style={{borderLeft:`2px solid ${catColor}44`}}>
          {bet.reasoning}
        </div>

        {/* Aide modification cote */}


        {/* Mise Kelly + ticket */}
        <div className='bet-card-footer'>
          {mise ? (
            <div style={{flex:1}}>
              <div className='bet-card-mise-label'>Mise Kelly {isModified?'· perso':''}</div>
              <div className='bet-card-mise-val'>{mise}€ <span className='bet-card-mise-gain'>+{gain}€</span></div>
              {isModified && (
                <div style={{fontSize:10,color:'#8b9ab5',marginTop:2}}>
                  Cote IA: {bet.aiOddsOriginal??bet.odds} · Ta cote: {customOdd}
                </div>
              )}
              {!isModified && bet.hasRealOdd && bet.aiOddsOriginal && (
                <div style={{fontSize:10,color:'#4a5568',marginTop:2}}>
                  Cote IA: {bet.aiOddsOriginal} → Réelle: <span style={{color:'#00e676'}}>{customOdd}</span>
                </div>
              )}
            </div>
          ) : (
            <div style={{flex:1,fontSize:12,color:'var(--text-disabled)'}}>—</div>
          )}
          <button className='bet-btn' onClick={() => { if(bet.match.prediction) onAddTicket(bet.match, bet.match.prediction, customOdd, bet.label, bet.id, bet.odds); }}>+ Ticket</button>
        </div>
      </div>
    </div>
  );
}

// ─── BEST BETS PANEL PRINCIPAL ────────────────────────────────
interface BetsPanelProps {
  matches: MatchWithPred[];
  solde: number;
  allOdds: Record<string, MatchOddsData>;
  selectedBk: string;
  onAddTicket: (match: Match, pred: Prediction, key: string, bk: string, customOdd?: number, betLabel?: string, aiOdd?: number) => void;
}

function BestBetsPanel({ matches, solde, allOdds, selectedBk, onAddTicket }: BetsPanelProps) {
  const [activeCat, setActiveCat] = useState<BetCat>('safe');
  const today = new Date();

  // Meilleurs paris : uniquement les matchs PAS encore commencés
  const allBets = matches
    .filter(m => !m.isDone && !m.isLive && m.prediction)
    .flatMap(m => {
      // Cotes réelles du bookmaker sélectionné pour ce match (1X2)
      const bkOdds = allOdds[m.id]?.bkMap?.[selectedBk]
        ?? (allOdds[m.id] ? Object.values(allOdds[m.id].bkMap)[0] : undefined);
      return (m.prediction?.bets ?? []).map(b => {
        // Pour les paris 1X2, remplacer la cote IA par la cote bookmaker réelle
        let realOdd = b.odds; // cote IA par défaut
        if (bkOdds) {
          if (b.id.includes('_result') || (b.label.includes('Victoire') && !b.label.includes('&') && !b.label.includes('+'))) {
            const pk = m.prediction?.predictionKey;
            const bkVal = pk ? bkOdds[pk] : null;
            if (bkVal && bkVal > 0) realOdd = bkVal;
          } else if (b.label === 'Match nul') {
            if (bkOdds.draw && bkOdds.draw > 0) realOdd = bkOdds.draw;
          }
        }
        // Value indicator : cote réelle vs cote IA
        const valuePct = realOdd !== b.odds ? Math.round((realOdd / b.odds - 1) * 100) : 0;
        return {
          ...b,
          odds: realOdd,          // cote affichée (réelle si dispo, IA sinon)
          aiOddsOriginal: b.odds, // cote IA originale conservée
          hasRealOdd: realOdd !== b.odds,
          valuePct,
          match: m,
          mise: kellyStake(solde, b.confidence, realOdd, b.risk),
        };
      });
    });

  const filtered = allBets
    .filter(b => b.category === activeCat)
    .sort((a, b2) => b2.confidence - a.confidence);

  const meta = CAT_META[activeCat];

  // Wrapper : traduit l'appel BetCard → handleAddTicket du parent
  const handleAddTicketWithOdd = (match: Match, pred: Prediction, customOdd: number, betLabel: string, betId: string, aiOdd: number) => {
    // On passe betLabel et betId via le paramètre bookmaker en encodant dans un objet sérialisé
    // Mais le plus propre est d'appeler onAddTicket avec une signature étendue
    onAddTicket(match, pred, betId, 'custom', customOdd, betLabel, aiOdd);
  };

  return (
    <div className='anim'>
      <div style={{marginBottom:20}}>
        <div style={{fontSize:22,fontWeight:600,color:'var(--text-primary)',letterSpacing:'-.02em'}}>Meilleurs Paris</div>
        <div style={{fontSize:11,color:'var(--text-disabled)',marginTop:2,fontFamily:'var(--font-mono)'}}>Cotes modifiables · Matchs à venir uniquement</div>
      </div>

      {/* Onglets */}
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        {(Object.keys(CAT_META) as BetCat[]).map(cat => {
          const cm = CAT_META[cat];
          const count = allBets.filter(b => b.category === cat).length;
          const isActive = activeCat === cat;
          return (
            <button key={cat} onClick={() => setActiveCat(cat)}
              style={{display:'flex',alignItems:'center',gap:8,padding:'10px 16px',borderRadius:10,border:`1px solid ${isActive?cm.border:'rgba(255,255,255,.08)'}`,background:isActive?cm.bg:'#111621',cursor:'pointer',transition:'.15s',flex:1,minWidth:140}}>
              <span style={{fontSize:20}}>{cm.emoji}</span>
              <div style={{textAlign:'left'}}>
                <div style={{fontFamily:'Barlow Condensed',fontSize:15,fontWeight:800,color:isActive?cm.color:'#fff'}}>
                  {cm.label} <span style={{fontSize:12,color:isActive?cm.color:'#4a5568',fontWeight:600}}>({count})</span>
                </div>
                <div style={{fontSize:10,color:'#4a5568',marginTop:1}}>{cm.desc}</div>
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{textAlign:'center',padding:'50px 0',color:'var(--text-disabled)',fontSize:11,fontFamily:'var(--font-mono)'}}>
          Aucun pari {meta.label.toLowerCase()} disponible.
        </div>
      )}

      {/* Pub entre catégories et grille */}
      <AdBanner
        slot={process.env.NEXT_PUBLIC_AD_SLOT_MID ?? 'YOUR_AD_SLOT_ID'}
        format="horizontal"
        fullWidth
        style={{marginBottom:16,borderRadius:6,overflow:'hidden'}}
      />

      {/* Grille */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:10}}>
        {filtered.map(bet => (
          <BetCard
            key={bet.id}
            bet={bet}
            catColor={meta.color}
            catBg={meta.bg}
            catBorder={meta.border}
            solde={solde}
            onAddTicket={handleAddTicketWithOdd}
          />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [tab,setTab] = useState<Tab>('dashboard');
  const [selectedMatch,setSelectedMatch] = useState<MatchWithPred|null>(null);
  const [solde,setSolde] = useState<number>(0);
  const [showBalModal,setShowBalModal] = useState(false);
  const [balInput,setBalInput] = useState('');
  const [selectedBk,setSelectedBk] = useState('winamax_fr');
  const [history,setHistory] = useState<BetEntry[]>([]);
  const [ticket,setTicket] = useState<TicketItem[]>([]);
  const [showTicket,setShowTicket] = useState(false);
  const [selectedDay,setSelectedDay] = useState<string>(()=>parisDayISO());
  const [matches,setMatches] = useState<MatchWithPred[]>([]);
  const [allOdds,setAllOdds] = useState<Record<string,MatchOddsData>>({});
  const [loadingMatches,setLoadingMatches] = useState(true);
  const [oddsAvail,setOddsAvail] = useState(false);
  const [matchErr,setMatchErr] = useState('');
  const [configStatus,setConfigStatus] = useState<{footballData:{configured:boolean},oddsApi:{configured:boolean}}|null>(null);
  const [openLeagues,setOpenLeagues] = useState<Record<string,boolean>>({});
  const detailRef = useRef<HTMLDivElement>(null);

  // Hydrate from localStorage
  useEffect(()=>{
    setSolde(parseFloat(localStorage.getItem('sai_solde')??'0'));
    setSelectedBk(localStorage.getItem('sai_bk')??'winamax_fr');
    setHistory(JSON.parse(localStorage.getItem('sai_hist')??'[]'));
  },[]);

  const loadMatches = useCallback(async(day: string)=>{
    setLoadingMatches(true);
    try {
      const r = await fetch(`/api/matches?date=${day}`);
      const d = await r.json();
      if (!d.ok){ setMatchErr(d.error??'Erreur'); setLoadingMatches(false); return; }
      const ms: MatchWithPred[] = d.matches??[];
      setMatches(ms); setMatchErr('');
      setOpenLeagues(prev=>{
        const next={...prev};
        ms.forEach((m:MatchWithPred)=>{ if(next[m.competition]===undefined) next[m.competition]=true; });
        return next;
      });
      // Charger les cotes en parallèle
      const compIds=[...new Set(ms.filter(m=>!m.isDone).map(m=>m.competitionId))];
      const oddsMap:Record<string,MatchOddsData>={};
      await Promise.all(compIds.map(async cid=>{
        try{
          const isLive = ms.some(m=>m.competitionId===cid&&m.isLive);
          const ro=await fetch(`/api/odds?compId=${cid}${isLive?'&live=1':''}`);
          const od=await ro.json();
          if(od.ok&&od.odds?.length){
            ms.filter(m=>m.competitionId===cid&&!m.isDone).forEach(m=>{
              const res=matchOddsToMatch(m,od.odds);
              if(res) oddsMap[m.id]=res;
            });
          }
        }catch(_){}
      }));
      if(Object.keys(oddsMap).length){
        setAllOdds(oddsMap);
        setOddsAvail(true);
        // Auto-select first bookmaker that actually has data if current selection is missing
        setSelectedBk(prev => {
          const hasData = Object.values(oddsMap).some(od => od.bkMap[prev]);
          if (hasData) return prev;
          // Find the bookmaker with most coverage across matches
          const bkCount: Record<string,number> = {};
          Object.values(oddsMap).forEach(od => Object.keys(od.bkMap).forEach(k => { bkCount[k]=(bkCount[k]??0)+1; }));
          const best = Object.entries(bkCount).sort((a,b)=>b[1]-a[1])[0]?.[0];
          return best ?? prev;
        });
      } else setAllOdds({});
    } catch(e){ setMatchErr((e as Error).message); }
    setLoadingMatches(false);
  },[]);

  useEffect(()=>{
    fetch('/api/status').then(r=>r.json()).then(d=>setConfigStatus(d)).catch(()=>{});
    loadMatches(selectedDay);
    // Refresh toutes les 30s (matchs live)
    const t=setInterval(()=>loadMatches(selectedDay),30_000);
    return()=>clearInterval(t);
  },[loadMatches,selectedDay]);

  const saveSolde=(s:number)=>{ setSolde(s); localStorage.setItem('sai_solde',String(s)); setShowBalModal(false); };
  const saveBk=(k:string)=>{ setSelectedBk(k); localStorage.setItem('sai_bk',k); };
  const saveHist=(h:BetEntry[])=>{ setHistory(h); localStorage.setItem('sai_hist',JSON.stringify(h)); };

  const handleSelect=(m:MatchWithPred)=>{
    setSelectedMatch(prev=>prev?.id===m.id?null:m);
    setTimeout(()=>detailRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),80);
  };
  const handleAddTicket=(match:Match,pred:Prediction,key:string,bookmaker:string,customOdd?:number,betLabel?:string,aiOdd?:number)=>{
    const names={home:`Victoire ${match.homeTeam.name}`,draw:'Match nul',away:`Victoire ${match.awayTeam.name}`};
    // Si betLabel fourni (vient de BetCard), on l'utilise — sinon on prend le nom du résultat 1X2
    const label = betLabel ?? names[key as keyof typeof names] ?? key;
    // baseOdd : pour les paris 1X2 on prend pred.odds, pour les paris spéciaux on prend aiOdd
    const baseOdd = aiOdd ?? pred.odds[key as keyof typeof pred.odds] ?? customOdd ?? 1.5;
    const odd = customOdd ?? baseOdd;
    const isCustomOdd = customOdd != null && Math.abs(customOdd - baseOdd) > 0.01;
    const betId = `${match.id}_${key}`;
    setTicket(p => p.find(t => t.betId === betId) ? p : [...p, {
      match, pred, key, odd,
      predLabel: label,
      bookmaker, isCustomOdd, betId,
      aiOdd: baseOdd,
    }]);
    setShowTicket(true);
  };
  const handleSubmitTicket=(mise:number)=>{
    const entry:BetEntry={
      matchName:ticket.map(t=>`${t.match.homeTeam.name} vs ${t.match.awayTeam.name}`).join(' + '),
      pred:ticket.map(t=>t.predLabel).join(' + '),
      odd:ticket.reduce((p,t)=>p*t.odd,1).toFixed(2),
      mise, gain:parseFloat((mise*ticket.reduce((p,t)=>p*t.odd,1)).toFixed(2)),
      result:'pending',
      bookmaker:BOOKMAKERS.find(b=>b.key===ticket[0]?.bookmaker)?.name??'IA',
      competition:ticket.map(t=>t.match.competition).join(', '),
      date:new Date().toISOString(),
    };
    saveSolde(Math.max(0,solde-mise));
    saveHist([...history,entry]);
    setTicket([]); setShowTicket(false); setTab('history');
  };
  const handleMark=(idx:number,result:'win'|'loss')=>{
    const h=[...history];
    if(result==='win') saveSolde(solde+h[idx].gain);
    h[idx]={...h[idx],result}; saveHist(h);
  };

  const byLeague=Object.entries(COMPETITIONS).sort((a,b)=>a[1].order-b[1].order)
    .map(([id,meta])=>({id:Number(id),meta,ms:matches.filter(m=>m.competitionId===Number(id))}))
    .filter(x=>x.ms.length>0);
  const liveCnt=matches.filter(m=>m.isLive).length;
  const progCnt=matches.filter(m=>!m.isLive&&!m.isDone).length;
  const today=new Date();
  const brk:React.CSSProperties={background:'#111621',border:'1px solid rgba(255,255,255,.055)',borderRadius:10,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'};

  return (
    <>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        .anim{animation:fadeUp .22s ease}
        table tr:hover td{background:rgba(255,255,255,.02)}
      `}</style>

      {/* NAV */}
      <nav className='nav'>
        <div className='nav-logo'><div className='nav-logo-dot'/><span>SportAI</span></div>
        <div className='nav-tabs'>
          {([['dashboard','⚽ Matchs du jour'],['bestbets','🏆 Meilleurs paris'],['history','📊 Historique']] as const).map(([id,l])=>(
            <button key={id} onClick={()=>{setTab(id);setSelectedMatch(null);}}
              className={`nav-tab${tab===id?' active':''}`}>{l}</button>
          ))}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8,marginLeft:'auto'}}>
          <div className='live-dot'/>
          {/* Bookmaker */}
          <div className='nav-bk-wrap'>
            <span className='nav-bk-label'>Bookmaker</span>
            <select value={selectedBk} onChange={e=>saveBk(e.target.value)} className='nav-bk-select'>
              {BOOKMAKERS.map(b=>{const hasOdds=Object.values(allOdds).some(od=>od.bkMap[b.key]);return <option key={b.key} value={b.key} style={{background:'var(--surface-3)'}}>{hasOdds?'✓ ':''}{b.emoji} {b.name}</option>;})}
              {(()=>{const known=new Set(BOOKMAKERS.map(b=>b.key));const extra=new Set(Object.values(allOdds).flatMap(od=>Object.keys(od.bkMap)).filter(k=>!known.has(k)));return [...extra].map(k=><option key={k} value={k} style={{background:'var(--surface-3)'}}>✓ 🎰 {k}</option>);})()}
            </select>
          </div>
          {/* Solde */}
          <div className='nav-balance' onClick={()=>{setBalInput(String(solde||''));setShowBalModal(true);}}>
            <div className='nav-balance-label'>Solde</div>
            <div className='nav-balance-val' style={{color:solde>0?'var(--green)':'var(--text-tertiary)'}}>{solde>0?`${solde.toFixed(2)}€`:'—'}</div>
          </div>
          {ticket.length>0&&<button className='nav-ticket-btn' onClick={()=>setShowTicket(p=>!p)}>Ticket ({ticket.length})</button>}
        </div>
      </nav>

      <main>

        {/* ═══ DASHBOARD ═══ */}
        {tab==='dashboard'&&<div className='anim'>

          {/* ── SÉLECTEUR DE JOURS (style FlashScore) ── */}
          {(()=>{
            const today = parisDayISO();
            const days = Array.from({length:9},(_,i)=>addDays(today,i-3));
            return (
              <div className='day-strip'>
                {days.map(day=>{
                  const lbl=fmtDayLabel(day);
                  const isActive=day===selectedDay;
                  const isPast=day<today;
                  return (
                    <button key={day} onClick={()=>{setSelectedDay(day);setSelectedMatch(null);}}
                      className={`day-btn${isActive?' active':''}${isPast?' past':''}`}>
                      <div className='day-btn-top'>{lbl.top}</div>
                      <div className='day-btn-bot'>{lbl.bot}</div>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          {/* ── PUB HAUT DE PAGE ── */}
          <AdBanner
            slot={process.env.NEXT_PUBLIC_AD_SLOT_TOP ?? 'YOUR_AD_SLOT_ID'}
            format="horizontal"
            fullWidth
            style={{marginBottom:14,borderRadius:6,overflow:'hidden'}}
          />

          {/* ── HEADER DATE ── */}
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:22,fontWeight:600,color:'var(--text-primary)',letterSpacing:'-.02em'}}>
                {fmtDayLabel(selectedDay).isToday?'Matchs du jour':fmtDayLabel(selectedDay).top==='Hier'?"Matchs d'hier":'Matchs du '+fmtDayLabel(selectedDay).top+' '+fmtDayLabel(selectedDay).bot}
              </div>
              <div style={{fontSize:11,color:'var(--text-disabled)',marginTop:2,fontFamily:'var(--font-mono)'}}>
                football-data.org{oddsAvail?' · cotes réelles':''}
              </div>
            </div>
            <div style={{display:'flex',gap:6,marginLeft:'auto',flexWrap:'wrap'}}>
              {matches.filter(m=>m.isLive).length>0&&<span className='badge badge-live'>● {matches.filter(m=>m.isLive).length} live</span>}
              {matches.filter(m=>!m.isLive&&!m.isDone).length>0&&<span className='badge badge-blue'>{matches.filter(m=>!m.isLive&&!m.isDone).length} à venir</span>}
              {matches.filter(m=>m.isDone).length>0&&<span className='badge badge-muted'>{matches.filter(m=>m.isDone).length} terminés</span>}
              <span className='badge badge-muted' style={{marginLeft:'auto'}}>{matches.length}m</span>
            </div>
          </div>

          {/* Config warning */}
          {configStatus&&!configStatus.footballData?.configured&&(
            <div style={{background:'var(--red-dim)',border:'1px solid rgba(239,68,68,.18)',borderRadius:'var(--radius-md)',padding:'12px 16px',marginBottom:14,fontSize:13,color:'var(--text-secondary)',lineHeight:1.8}}>
              <strong style={{color:'var(--red)',fontFamily:'var(--font-mono)',fontSize:11}}>FOOTBALL_DATA_KEY manquant</strong><br/> — Vercel → Settings → Environment Variables<br/>
              Clé gratuite : <a href="https://www.football-data.org/client/register" target="_blank" style={{color:'#4f8ef7'}}>football-data.org/client/register</a> · Diagnostic : <a href="/api/status" target="_blank" style={{color:'#4f8ef7'}}>/api/status</a>
            </div>
          )}
          {matchErr&&!loadingMatches&&<div style={{background:'rgba(255,75,75,.08)',border:'1px solid rgba(255,75,75,.2)',borderRadius:8,padding:'12px 14px',marginBottom:14,fontSize:13,color:'#8b9ab5'}}>⚠ {matchErr} · <a href="/api/status" target="_blank" style={{color:'#4f8ef7'}}>Diagnostic</a></div>}

          {/* Bankroll */}
          {solde>0&&<div className='brk-bar'>
            {[{l:'Solde',v:`${solde.toFixed(2)}€`,c:'var(--green)'},{l:'Stratégie',v:'¼ Kelly',c:'var(--text-secondary)'},{l:'Matchs',v:String(matches.length),c:'var(--text-primary)'},{l:'Live',v:String(matches.filter(m=>m.isLive).length),c:matches.some(m=>m.isLive)?'var(--red)':'var(--text-disabled)'},{l:'Book',v:BOOKMAKERS.find(b=>b.key===selectedBk)?.name??'—',c:'var(--amber)'}].map(({l,v,c},i,arr)=>(
              <div key={l} style={{display:'flex',alignItems:'center',gap:14}}>
                <div><div className='brk-stat-label'>{l}</div><div className='brk-stat-val' style={{color:c}}>{v}</div></div>
                {i<arr.length-1&&<div className='brk-divider'/>}
              </div>
            ))}
          </div>}

          {loadingMatches&&<div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:200,gap:12,color:'var(--text-disabled)'}}><Spinner/><span style={{fontSize:12,fontFamily:'var(--font-mono)'}}>Chargement…</span></div>}

          {!loadingMatches&&(()=>{
            // ── SECTION LIVE ──
            const liveMs = matches.filter(m=>m.isLive);
            // ── MATCHS À VENIR ──
            const upcomingMs = matches.filter(m=>!m.isLive&&!m.isDone);
            // ── MATCHS TERMINÉS ──
            const doneMs = matches.filter(m=>m.isDone);

            const byLeague = (ms: MatchWithPred[]) =>
              Object.entries(COMPETITIONS).sort((a,b)=>a[1].order-b[1].order)
                .map(([id,meta])=>({id:Number(id),meta,ms:ms.filter(m=>m.competitionId===Number(id))}))
                .filter(x=>x.ms.length>0);

            const colHdr = '82px 1fr 100px 1fr 148px 192px';

            const renderLeague = (id:number,meta:typeof COMPETITIONS[number],ms:MatchWithPred[],dim=false)=>{
              const closed=openLeagues[meta.name]===false;
              return (
                <div key={id} style={{marginBottom:16,opacity:dim?0.7:1}}>
                  <div className={`league-hdr ${closed?'closed':'open'}`} style={{borderLeft:`3px solid ${meta.color}`}}
                    onClick={()=>setOpenLeagues(p=>({...p,[meta.name]:!closed}))}>
                    <span style={{fontSize:15}}>{meta.flag}</span>
                    <span className='league-name'>{meta.name}</span>
                    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
                      {oddsAvail&&ms.some(m=>allOdds[m.id])&&<span className='badge badge-green'>✓ Live</span>}
                      <span style={{fontSize:10,color:'var(--text-disabled)',fontFamily:'var(--font-mono)'}}>{ms.length}m</span>
                      <span style={{fontSize:10,color:'var(--text-disabled)'}}>{closed?'▼':'▲'}</span>
                    </div>
                  </div>
                  {!closed&&<div className='league-body'>
                    <div className='col-headers'>
                      {['Heure','Dom.','Score','Ext.','Prédiction IA','Cotes'].map((h,i)=>(
                        <div key={i} className='col-hdr-cell' style={{textAlign:i===0?'center':'left'}}>{h}</div>
                      ))}
                    </div>
                    {ms.map(m=><MatchRow key={m.id} match={m} oddsData={allOdds[m.id]} selectedBk={selectedBk} selected={selectedMatch?.id===m.id} onSelect={handleSelect} onAddTicket={handleAddTicket}/>)}
                  </div>}
                </div>
              );
            };

            return (
              <>
                {/* ── EN DIRECT ── */}
                {liveMs.length>0&&(
                  <div style={{marginBottom:20}}>
                    <div className='section-div section-div-live'>
                      <span className='section-div-label'>● En Direct</span>
                      <div className='section-div-line'/>
                    </div>
                    {byLeague(liveMs).map(({id,meta,ms})=>renderLeague(id,meta,ms))}
                  </div>
                )}

                {/* ── PUB ENTRE SECTIONS ── */}
                {liveMs.length > 0 && upcomingMs.length > 0 && (
                  <AdBanner
                    slot={process.env.NEXT_PUBLIC_AD_SLOT_MID ?? 'YOUR_AD_SLOT_ID'}
                    format="rectangle"
                    style={{marginBottom:18,borderRadius:6,overflow:'hidden'}}
                  />
                )}

                {/* ── À VENIR ── */}
                {upcomingMs.length>0&&(
                  <div style={{marginBottom:20}}>
                    {liveMs.length>0&&<div className='section-div'><span className='section-div-label'>À Venir</span><div className='section-div-line'/></div>}
                    {byLeague(upcomingMs).map(({id,meta,ms})=>renderLeague(id,meta,ms))}
                  </div>
                )}

                {/* ── TERMINÉS (repliés par défaut) ── */}
                {doneMs.length>0&&(
                  <div style={{marginBottom:20}}>
                    <div className='section-div'><span className='section-div-label'>Terminés</span><div className='section-div-line'/></div>
                    {byLeague(doneMs).map(({id,meta,ms})=>renderLeague(id,meta,ms,true))}
                  </div>
                )}

                {matches.length===0&&!matchErr&&(
                  <div style={{textAlign:'center',padding:'50px 0',color:'var(--text-disabled)',fontSize:12,fontFamily:'var(--font-mono)'}}>
                    Aucun match programmé ce jour.
                  </div>
                )}

                {selectedMatch&&<div ref={detailRef}>
                  <MatchDetail match={selectedMatch} oddsData={allOdds[selectedMatch.id]} solde={solde} selectedBk={selectedBk} onAddTicket={handleAddTicket}/>
                </div>}
              </>
            );
          })()}
        </div>}

        {/* ═══ MEILLEURS PARIS ═══ */}
        {tab==='bestbets'&&<BestBetsPanel matches={matches} solde={solde} allOdds={allOdds} selectedBk={selectedBk} onAddTicket={handleAddTicket}/>}

        {/* ═══ HISTORIQUE ═══ */}
        {tab==='history'&&<div className='anim'>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:22,fontWeight:600,color:'var(--text-primary)',letterSpacing:'-.02em'}}>Historique</div>
            <div style={{fontSize:11,color:'var(--text-disabled)',marginTop:2,fontFamily:'var(--font-mono)'}}>{history.length} pari{history.length>1?'s':''}</div>
          </div>
          {(()=>{
            const wins=history.filter(h=>h.result==='win');
            const losses=history.filter(h=>h.result==='loss');
            const tM=history.reduce((s,h)=>s+h.mise,0);
            const tG=wins.reduce((s,h)=>s+h.gain-h.mise,0);
            const tP=losses.reduce((s,h)=>s+h.mise,0);
            const roi=tM>0?((tG-tP)/tM*100).toFixed(1):'0';
            return <>
              <div className='brk-bar'>
                {[{l:'Solde actuel',v:`${solde.toFixed(2)}€`,c:'#00e676'},{l:'Gains nets',v:`+${tG.toFixed(2)}€`,c:'#00e676'},{l:'Pertes',v:`-${tP.toFixed(2)}€`,c:'#ff4b4b'},{l:'ROI',v:`${roi}%`,c:parseFloat(roi)>=0?'#00e676':'#ff4b4b'},{l:'Taux victoires',v:history.length>0?`${Math.round(wins.length/(wins.length+losses.length||1)*100)}%`:'—',c:'#f0f4ff'}].map(({l,v,c},i,arr)=>(
                  <div key={l} style={{display:'flex',alignItems:'center',gap:14}}>
                    <div><div style={{fontSize:10,color:'#4a5568',textTransform:'uppercase',letterSpacing:.7,fontWeight:700}}>{l}</div><div style={{fontFamily:'Barlow Condensed',fontSize:17,fontWeight:800,color:c}}>{v}</div></div>
                    {i<arr.length-1&&<div style={{width:1,height:26,background:'rgba(255,255,255,.055)'}}/>}
                  </div>
                ))}
              </div>
              {history.length===0&&<div style={{textAlign:'center',padding:'50px 0',color:'var(--text-disabled)',fontSize:11,fontFamily:'var(--font-mono)'}}>Aucun pari enregistré.</div>}
              <AdBanner
                slot={process.env.NEXT_PUBLIC_AD_SLOT_BOTTOM ?? 'YOUR_AD_SLOT_ID'}
                format="horizontal"
                fullWidth
                style={{marginTop:16,borderRadius:6,overflow:'hidden'}}
              />
              {history.length>0&&<div className='card'>
                {[...history].reverse().map((h,i)=>{
                  const ri=history.length-1-i;
                  const isWin=h.result==='win',isLoss=h.result==='loss';
                  return <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderBottom:i<history.length-1?'1px solid rgba(255,255,255,.055)':'none'}}>
                    <div className={`hist-badge ${isWin?'hist-w':isLoss?'hist-l':'hist-p'}`}>
                      {isWin?'W':isLoss?'L':'?'}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,color:'#fff',fontWeight:500}}>{h.matchName}</div>
                      <div style={{fontSize:11,color:'#8b9ab5',marginTop:2}}>{h.pred} · Cote {h.odd} · {h.bookmaker} · {h.competition}</div>
                      <div style={{fontSize:10,color:'#4a5568',marginTop:1}}>{new Date(h.date).toLocaleString('fr-FR')}</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:11,color:'#4a5568'}}>Mise: {h.mise}€</div>
                      <div style={{fontFamily:'Barlow Condensed',fontSize:15,fontWeight:800,color:isWin?'#00e676':isLoss?'#ff4b4b':'#4f8ef7'}}>
                        {isWin?`+${(h.gain-h.mise).toFixed(2)}`:isLoss?`-${h.mise.toFixed(2)}`:'En attente'}€
                      </div>
                      {h.result==='pending'&&<div style={{display:'flex',gap:4,marginTop:4,justifyContent:'flex-end'}}>
                        {(['win','loss'] as const).map(r=><button key={r} onClick={()=>handleMark(ri,r)} style={{border:'none',borderRadius:5,padding:'2px 8px',cursor:'pointer',fontSize:10,fontWeight:700,background:r==='win'?'rgba(0,230,118,.08)':'rgba(255,75,75,.08)',color:r==='win'?'#00e676':'#ff4b4b',borderWidth:1,borderStyle:'solid',borderColor:r==='win'?'rgba(0,230,118,.2)':'rgba(255,75,75,.2)'}}>
                          {r==='win'?'✓ Gagné':'✗ Perdu'}
                        </button>)}
                      </div>}
                    </div>
                  </div>;
                })}
              </div>}
            </>;
          })()}
        </div>}
      </main>

      {/* MODAL SOLDE */}
      {showBalModal&&<div className='modal-overlay'>
        <div className='modal'>
          <div className='modal-title'>Bankroll</div>
          <div className='modal-sub'>Entrez votre solde réel. SportAI calcule les mises via le critère de Kelly ¼.</div>
          <div className='modal-label'>Solde (€)</div>
          <input type="number" min="1" step="0.01" placeholder="250.00" value={balInput} onChange={e=>setBalInput(e.target.value)} autoFocus
            style={{width:'100%',background:'#181e2b',border:'1px solid rgba(255,255,255,.09)',borderRadius:8,padding:'11px 14px',fontFamily:'Barlow Condensed',fontSize:26,fontWeight:800,color:'#fff',outline:'none',textAlign:'right'}}/>
          <div className='modal-actions'>
            <button onClick={()=>parseFloat(balInput)>0&&saveSolde(parseFloat(balInput))} className='btn-primary'>Confirmer</button>
            {solde>0&&<button onClick={()=>setShowBalModal(false)} className='btn-secondary'>Annuler</button>}
          </div>
        </div>
      </div>}

      {showTicket&&<Ticket items={ticket} solde={solde} onRemove={i=>setTicket(p=>p.filter((_,j)=>j!==i))} onSubmit={handleSubmitTicket} onClose={()=>setShowTicket(false)}/>}
    </>
  );
}
