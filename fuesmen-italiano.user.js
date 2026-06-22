// ==UserScript==
// @name         Asistente FUESMEN -> Hospital Italiano
// @namespace    fuesmen.local
// @version      7.10
// @description  Asistente multiusuario: login Supabase, worklist y coordinacion (lock al cargar) en la nube. Muestra el N de turno de FUESMEN al lado de cada pedido y lo carga en "Numero de informe". v7: automatizacion SIN TURNO (busca DNI +-3 dias en FUESMEN y anula en Italiano con confirmacion en lote). v7.7: cache local de worklist => la info propia (turnos/badges/contadores) aparece al instante en cada recarga; refresca en segundo plano y repinta solo si cambio. v7.8: el N de pedido aparece en todas las filas (incluidas las sin turno). v7.9: en la grilla de FUESMEN el N° Ref aparece en TODAS las filas del turno (antes solo en la primera) y el badge se renombra a "N° Ref". v7.10: la anulacion SIN TURNO ahora sobrevive las recargas (cola en localStorage), procesa en tandas de 20 con confirmacion entre tandas y boton PARAR; ya no se marca anulado si no se encontro el boton baja().
// @updateURL    https://raw.githubusercontent.com/santipitre/fuesmen-italiano/main/fuesmen-italiano.user.js
// @downloadURL  https://raw.githubusercontent.com/santipitre/fuesmen-italiano/main/fuesmen-italiano.user.js
// @match        http://hitalianomza.no-ip.org:9000/*
// @match        https://hitalianomza.no-ip.org:9000/*
// @match        http://his.fuesmen.edu.ar:8180/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @connect      kjwsruebchhhrqwicdfx.supabase.co
// @connect      raw.githubusercontent.com
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-end
// ==/UserScript==
(function () {
  'use strict';
  var SB_URL = 'https://kjwsruebchhhrqwicdfx.supabase.co';
  var SB_KEY = 'sb_publishable_VVVtZ9H7Lz3PnOBqgNibKA_b4Uxg6G9';
  var RAW_URL='https://raw.githubusercontent.com/santipitre/fuesmen-italiano/main/fuesmen-italiano.user.js';
  var SCRIPT_VER=(typeof GM_info!=='undefined' && GM_info.script && GM_info.script.version) || '0';
  var LATEST_VER=null;
  function verCmp(a,b){ a=(''+a).split('.').map(Number); b=(''+b).split('.').map(Number); for(var i=0;i<Math.max(a.length,b.length);i++){ var x=a[i]||0,y=b[i]||0; if(x!==y) return x<y?-1:1; } return 0; }
  function fmParseVer(txt){ var i=txt.indexOf('@version'); if(i<0) return null; var rest=txt.slice(i+8, i+30); var vv=''; for(var k=0;k<rest.length;k++){ var ch=rest[k]; if((ch>='0'&&ch<='9')||ch==='.'){ vv+=ch; } else if(vv){ break; } } return vv||null; }
  function openUpdate(){ try{ window.open(RAW_URL,'_blank'); }catch(e){} }
  function showUpdateBar(ver){
    if(document.getElementById('fm-upd')) return;
    var bar=document.createElement('div'); bar.id='fm-upd';
    bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:100002;background:#d1242f;color:#fff;font:800 15px Segoe UI,sans-serif;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    var tx=document.createElement('span'); tx.textContent='⚠ Asistente FUESMEN: hay una versión nueva (v'+ver+'). Tenés que actualizar.';
    var b=document.createElement('button'); b.textContent='ACTUALIZAR AHORA';
    b.style.cssText='font:800 14px Segoe UI;color:#d1242f;background:#fff;border:0;padding:8px 18px;border-radius:8px;cursor:pointer';
    b.onclick=openUpdate;
    var hint=document.createElement('span'); hint.style.cssText='font:600 12px Segoe UI;opacity:.92'; hint.textContent='(Apretá Actualizar, confirmá en Tampermonkey y recargá la página)';
    bar.appendChild(tx); bar.appendChild(b); bar.appendChild(hint);
    document.body.appendChild(bar);
    setInterval(function(){ if(!document.getElementById('fm-upd')) document.body.appendChild(bar); }, 5000);
  }
  function markLoginOutdated(ver){
    var ov=document.getElementById('fm-login'); if(!ov) return;
    var box=ov.firstChild; if(!box || box.querySelector('.fm-upd-note')) return;
    var note=document.createElement('div'); note.className='fm-upd-note';
    note.style.cssText='background:#fff0f0;border:2px solid #d1242f;border-radius:8px;padding:10px;margin-bottom:12px';
    var t=document.createElement('div'); t.style.cssText='font:800 13px Segoe UI;color:#d1242f;margin-bottom:6px'; t.textContent='⚠ Hay una versión nueva (v'+ver+'). Actualizá antes de entrar.';
    var b=document.createElement('button'); b.textContent='Actualizar ahora'; b.style.cssText='width:100%;font:700 13px Segoe UI;color:#fff;background:#d1242f;border:0;padding:9px;border-radius:8px;cursor:pointer'; b.onclick=openUpdate;
    note.appendChild(t); note.appendChild(b); box.insertBefore(note, box.firstChild);
  }
  function checkVersion(){
    try{
      GM_xmlhttpRequest({ method:'GET', url:RAW_URL+'?cb='+Date.now(), headers:{'Range':'bytes=0-400','Cache-Control':'no-cache'},
        onload:function(r){ var ver=fmParseVer(r.responseText||''); if(!ver) return; LATEST_VER=ver;
          if(verCmp(SCRIPT_VER,LATEST_VER)<0){ showUpdateBar(LATEST_VER); markLoginOutdated(LATEST_VER); } },
        onerror:function(){} });
    }catch(e){}
  }
  var STOP = ['DE','DEL','LA','EL','LOS','LAS','CON','SIN','POR','Y','O','A','EXP','EXPOSICION',
              'PRIMERA','SEGUNDA','OTROS','OTRO','OTRAS','REGIONES','ORGANOS','SIMPLE'];
  // Sinonimos: A y B nombran distinto el mismo estudio. Canonizamos antes de comparar.
  var SYN = { TELERX:'TELERRADIOGRAFIA', TELERADIOGRAFIA:'TELERRADIOGRAFIA', TELERAD:'TELERRADIOGRAFIA',
    RX:'RADIOGRAFIA', RADIOLOGIA:'RADIOGRAFIA', ECO:'ECOGRAFIA', ECODOPPLER:'ECOGRAFIA', DOPPLER:'ECOGRAFIA',
    DOPP:'ECOGRAFIA', DUPLEX:'ECOGRAFIA', TC:'TOMOGRAFIA', TAC:'TOMOGRAFIA', HELICOIDAL:'TOMOGRAFIA',
    RMN:'RESONANCIA', RM:'RESONANCIA', RNM:'RESONANCIA', TX:'TORAX' };

  // ---- utilidades ----
  function norm(s){ return (s||'').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim(); }
  function tokens(s){ return norm(s).split(' ').map(function(t){ return SYN[t]||t; }).filter(function(t){ return t.length>=3 && STOP.indexOf(t)<0 && !/^[0-9]+$/.test(t); }); }
  function score(a,b){ var A=tokens(a),B=tokens(b); if(!A.length||!B.length) return 0; var sa={}; A.forEach(function(t){sa[t]=1;}); var sb={}; B.forEach(function(t){sb[t]=1;}); var i=0; Object.keys(sa).forEach(function(t){ if(sb[t]) i++; }); var u={}; A.concat(B).forEach(function(t){u[t]=1;}); return i/Object.keys(u).length; }
  function onlyDigits(s){ return (s||'').replace(/[^0-9]/g,''); }
  function btnCss(c){ return 'font:600 12px Segoe UI;color:#fff;background:'+c+';border:0;padding:3px 10px;border-radius:6px;cursor:pointer;margin-left:4px'; }
  function toast(msg,color){ var d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;z-index:99999;right:18px;bottom:18px;max-width:380px;background:'+(color||'#0969da')+';color:#fff;padding:12px 16px;border-radius:8px;font:600 14px Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3)'; document.body.appendChild(d); setTimeout(function(){ d.style.transition='opacity .5s'; d.style.opacity='0'; setTimeout(function(){d.remove();},500); },4500); }

  // ====== SUPABASE: sesion / auth / datos ======
  function sbGetSession(){ try { return JSON.parse(GM_getValue('fuesmen_session','null')); } catch(e){ return null; } }
  function sbSetSession(s){ try { GM_setValue('fuesmen_session', JSON.stringify(s)); } catch(e){} }
  function sbClearSession(){ try { GM_deleteValue('fuesmen_session'); } catch(e){} }
  // ---- Cache local de la worklist (pintado instantaneo en cada recarga) ----
  var WL_HARD_MS = 24*60*60*1000; // mas vieja que esto: ignorar y esperar la red
  function wlCacheGet(){ try{ var o=JSON.parse(GM_getValue('fuesmen_wl_cache','null')); if(!o||!o.list||!o.list.length) return null; if((Date.now()-(o.t||0))>WL_HARD_MS) return null; return o; }catch(e){ return null; } }
  function wlCacheSet(list,sig){ try{ GM_setValue('fuesmen_wl_cache', JSON.stringify({t:Date.now(),sig:sig,list:list})); }catch(e){} }
  function wlSig(list){ var s=0; for(var i=0;i<list.length;i++){ var w=list[i]; var str=(w.TurnoN||'')+'|'+(w.DNI||''); for(var k=0;k<str.length;k++){ s=(s*31+str.charCodeAt(k))>>>0; } } return list.length+':'+s; }
  // Quita todo lo inyectado por annotate/applyCargas/markRevisar para poder repintar limpio.
  function clearAnnotations(){
    ['.fm-panel','.fm-dni','.fm-dni-nomatch','.fm-dia','.fm-pedido','.fm-carga','.fm-rev-badge'].forEach(function(sel){
      [].slice.call(document.querySelectorAll(sel)).forEach(function(n){ try{ n.remove(); }catch(e){} });
    });
    [].slice.call(document.querySelectorAll('tr')).forEach(function(r){
      if(r.dataset && r.dataset.fmRev){ r.dataset.fmRev=''; try{ r.style.outline=''; }catch(e){}
        [].slice.call(r.children).forEach(function(c){ if(c.tagName==='TD') c.style.backgroundColor=''; }); }
    });
    [].slice.call(document.querySelectorAll('[onclick*="informe("]')).forEach(function(a){ if(a.dataset) a.dataset.fmDone=''; });
  }
  function sbEmail(){ var s=sbGetSession(); return s ? s.email : ''; }
  function sbReq(method, path, token, body, ok, fail){
    var headers = { 'apikey': SB_KEY, 'Content-Type':'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    GM_xmlhttpRequest({ method:method, url:SB_URL+path, headers:headers,
      data: body ? JSON.stringify(body) : null,
      onload:function(r){ var d=null; try{ d = r.responseText ? JSON.parse(r.responseText) : null; }catch(e){}
        if (r.status>=200 && r.status<300) { ok && ok(d,r); } else { fail && fail(d,r); } },
      onerror:function(e){ fail && fail(null,e); } });
  }
  function sbLogin(email, password, ok, fail){
    sbReq('POST','/auth/v1/token?grant_type=password', null, { email:email, password:password },
      function(d){ if(d && d.access_token){ sbSetSession({ access_token:d.access_token, refresh_token:d.refresh_token, expires_at:(Date.now()/1000)+(d.expires_in||3600), email:(d.user&&d.user.email)||email }); ok && ok(); } else { fail && fail(d); } },
      function(d){ fail && fail(d); });
  }
  function sbWithToken(cb){
    var s = sbGetSession();
    if (!s){ cb(null); return; }
    if (s.expires_at && (Date.now()/1000) < (s.expires_at - 60)){ cb(s.access_token); return; }
    sbReq('POST','/auth/v1/token?grant_type=refresh_token', null, { refresh_token:s.refresh_token },
      function(d){ if(d && d.access_token){ s.access_token=d.access_token; s.refresh_token=d.refresh_token||s.refresh_token; s.expires_at=(Date.now()/1000)+(d.expires_in||3600); sbSetSession(s); cb(s.access_token); } else { sbClearSession(); cb(null); } },
      function(){ sbClearSession(); cb(null); });
  }
  function mapWl(w){ return { TurnoN:w.turno_n, DNI:w.dni, Fecha:w.fecha||'', Practicas:w.practicas||'', Alerta:(w.alerta?'SI':''), Aseguradora:w.aseguradora||'', Cuenta:w.cuenta||'', PedidoMed:w.pedido_med||'', Revisar:'' }; }
  function sbFetchWorklist(cb){
    sbWithToken(function(t){ if(!t){ cb(null); return; }
      var out=[], page=0, size=1000;
      function next(){
        var from=page*size, to=from+size-1;
        GM_xmlhttpRequest({ method:'GET', url:SB_URL+'/rest/v1/fuesmen_worklist?select=turno_n,pedido_med,dni,practicas,fecha,alerta,aseguradora,cuenta',
          headers:{ 'apikey':SB_KEY, 'Authorization':'Bearer '+t, 'Range-Unit':'items', 'Range':from+'-'+to },
          onload:function(r){ var d=[]; try{ d=JSON.parse(r.responseText)||[]; }catch(e){}
            out=out.concat(d);
            if (d.length===size){ page++; next(); } else { cb(out.map(mapWl)); } },
          onerror:function(){ cb(out.length?out.map(mapWl):null); } });
      }
      next();
    });
  }
  var USERNAMES={};
  function sbFetchUsuarios(cb){
    sbWithToken(function(t){ if(!t){ cb&&cb(); return; }
      sbReq('GET','/rest/v1/fuesmen_usuarios?select=email,nombre', t, null,
        function(d){ (d||[]).forEach(function(u){ USERNAMES[u.email]=u.nombre; }); cb&&cb(); },
        function(){ cb&&cb(); }); });
  }
  function shortName(email){ return USERNAMES[email] || (email||'').split('@')[0] || 'otro'; }

  // ---- Coordinacion (lock) ----
  var CARGAS={};
  function sbFetchCargas(cb){
    sbWithToken(function(t){ if(!t){ cb&&cb(); return; }
      sbReq('GET','/rest/v1/fuesmen_cargas?select=pedido_id,turno_n,estado,usuario_email,updated_at', t, null,
        function(d){ var m={}; (d||[]).forEach(function(c){ m[String(c.pedido_id)]=c; }); CARGAS=m; cb&&cb(); },
        function(){ cb&&cb(); }); });
  }
  function cargaUpsert(pedidoId, turnoN, estado){
    if(!pedidoId) return;
    sbWithToken(function(t){ if(!t) return;
      var row={ pedido_id:String(pedidoId), turno_n:String(turnoN||''), estado:estado, usuario_email:sbEmail(), updated_at:new Date().toISOString() };
      GM_xmlhttpRequest({ method:'POST', url:SB_URL+'/rest/v1/fuesmen_cargas',
        headers:{ 'apikey':SB_KEY, 'Authorization':'Bearer '+t, 'Content-Type':'application/json', 'Prefer':'resolution=merge-duplicates' },
        data:JSON.stringify([row]),
        onload:function(){ CARGAS[String(pedidoId)]=row; },
        onerror:function(){} });
    });
  }
  function cargaEstado(pedidoId){
    var c=CARGAS[String(pedidoId)]; if(!c) return {k:'free'};
    if(c.estado==='cargado') return {k:'done', email:c.usuario_email};
    if(c.usuario_email===sbEmail()) return {k:'mine'};
    var age=(Date.now()-new Date(c.updated_at).getTime())/60000;
    if(age>30) return {k:'free'};
    return {k:'locked', email:c.usuario_email};
  }

  // ---- MODO 2: pantalla "Carga informe" ----
  function findGuardar(){
    return [].slice.call(document.querySelectorAll('button,input[type=submit],input[type=button]'))
      .filter(function(b){ return /guardar/i.test(b.textContent||b.value||''); })[0];
  }
  function fillMode(input){
    var turno=sessionStorage.getItem('fuesmen_turno'); var meta=sessionStorage.getItem('fuesmen_meta')||'';
    var auto=sessionStorage.getItem('fuesmen_autosave')==='1';
    var pid=sessionStorage.getItem('fuesmen_pedidoid')||''; var tn=sessionStorage.getItem('fuesmen_turno_n')||turno;
    if(!turno){ toast('Asistente activo. Volve a la lista y apreta Cargar en un pedido.','#57606a'); return; }
    input.value=turno; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
    input.style.cssText+=';outline:3px solid #2ea043;background:#eaffea';
    sessionStorage.removeItem('fuesmen_turno'); sessionStorage.removeItem('fuesmen_meta'); sessionStorage.removeItem('fuesmen_autosave');
    var g=findGuardar();
    if(g){ g.style.cssText+=';outline:3px solid #2ea043;box-shadow:0 0 0 4px #2ea04344'; g.scrollIntoView({block:'center'}); }
    if(g && auto){
      sessionStorage.setItem('fuesmen_justsaved','1');
      toast('N° '+turno+' pegado'+(meta?(' - '+meta):'')+'. Guardando…','#2ea043');
      setTimeout(function(){ g.click(); try{ if(g.form && g.form.requestSubmit) g.form.requestSubmit(g); }catch(e){} if(pid){ cargaUpsert(pid, tn, 'cargado'); sessionStorage.removeItem('fuesmen_pedidoid'); sessionStorage.removeItem('fuesmen_turno_n'); } }, 300);
    } else {
      if(pid){ cargaUpsert(pid, tn, 'cargado'); sessionStorage.removeItem('fuesmen_pedidoid'); sessionStorage.removeItem('fuesmen_turno_n'); }
      toast('N de turno '+turno+' pegado'+(meta?(' - '+meta):'')+(g?'. Revisa y apreta GUARDAR.':'. No encontre GUARDAR; apretalo vos.'),'#2ea043');
    }
  }

  var DONE={};
  function nextPendingGreen(){
    var arr=Object.keys(SIDE_REG).map(function(id){ return SIDE_REG[id]; })
      .filter(function(e){ return e.kind==='green' && !DONE[e.id]; })
      .sort(function(a,b){ return dkey(a.fecha)-dkey(b.fecha); });
    if(arr[0]) scrollToPedido(arr[0], true);
  }

  var SIDE_REG={};
  function dkey(s){ var m=(s||'').match(/(\d{2})\D(\d{2})\D(\d{4})/); return m ? (+m[3]*10000 + (+m[2])*100 + (+m[1])) : 99999999; }
  function liveRow(e){
    if(!e) return null;
    if(e.id){
      var all=document.querySelectorAll('[onclick*="informe('+e.id+')"]');
      for(var i=0;i<all.length;i++){ if(all[i].offsetParent!==null) return all[i].closest('tr')||pedidoRow(all[i]); }
      if(all[0]) return all[0].closest('tr')||pedidoRow(all[0]);
    }
    return (e.info && e.info.tr && document.body.contains(e.info.tr)) ? e.info.tr : null;
  }
  function flashRow(tr, outline, bg){
    if(!tr) return;
    var cells = (tr.tagName==='TR') ? [].slice.call(tr.children) : [tr];
    if(!cells.length) cells=[tr];
    cells.forEach(function(c){
      var ob=c.style.backgroundColor, ot=c.style.transition;
      c.style.transition='background-color .3s'; c.style.backgroundColor=bg;
      setTimeout(function(){ c.style.backgroundColor=ob||''; c.style.transition=ot||''; }, 1800);
    });
    try{ var oo=tr.style.outline; tr.style.outline='3px solid '+outline; setTimeout(function(){ tr.style.outline=oo||''; }, 1800); }catch(e){}
  }
  function scrollToPedido(e, flash){
    var tr=liveRow(e); if(!tr) return;
    tr.scrollIntoView({block:'center', behavior:'smooth'});
    if(flash) flashRow(tr, '#2ea043', '#caf5d6');
  }
  function scrollToDni(arr){
    if(!arr||!arr.length) return;
    var first=liveRow(arr[0]); if(first) first.scrollIntoView({block:'center', behavior:'smooth'});
    arr.forEach(function(e){ flashRow(liveRow(e), '#1f6feb', '#cfe0ff'); });
  }

  // ---- MODO 1: lista de pedidos ----
  var DNIMAP={};
  function buildIndex(list){ DNIMAP={}; list.forEach(function(w){ var dni=onlyDigits(w.DNI); if(!dni) return; if(!DNIMAP[dni]) DNIMAP[dni]=[]; DNIMAP[dni].push({ turno:String(w.TurnoN), fecha:w.Fecha||'', practicas:(w.Practicas||'').split('|').map(function(x){return x.trim();}).filter(Boolean), revisar:w.Revisar==='SI', alerta:w.Alerta==='SI', aseg:w.Aseguradora||'', cuenta:w.Cuenta||'' }); }); }
  function bestForRow(dni,estudioB){ var arr=DNIMAP[onlyDigits(dni)]||[]; var cands=arr.map(function(c){ var sc=0; c.practicas.forEach(function(p){ var s=score(estudioB,p); if(s>sc) sc=s; }); return {c:c,sc:sc}; }); cands.sort(function(a,b){ return b.sc-a.sc; }); return cands; }
  function parseRow(anchor){
    var tr=anchor.closest('tr'); if(!tr) return null;
    var txt=tr.innerText||tr.textContent||'';
    var mDni=txt.match(/DNI[-\s]?([0-9]{6,9})/);
    var mId=(anchor.getAttribute('onclick')||'').match(/informe\(([0-9]+)\)/);
    if(!mId){ var any=tr.querySelector('[onclick*="informe("]'); if(any) mId=(any.getAttribute('onclick')||'').match(/informe\(([0-9]+)\)/); }
    var mEst=txt.match(/[0-9]\s*-\s*[0-9]{4,6}\s+([^\n]+)/);
    var mFec=txt.match(/([0-9]{2}\/[0-9]{2}\/[0-9]{4})/);
    var mPac=txt.match(/DNI[-\s]?[0-9]{6,9}\s*\n?\s*([^\n]+)/);
    return { tr:tr, anchor:anchor, dni:mDni?mDni[1]:'', pedidoId:mId?mId[1]:'', estudio:mEst?mEst[1].trim():'', fechaPedido:mFec?mFec[1]:'', paciente:mPac?mPac[1].trim():'' };
  }
  function loadInforme(info,turno,metaTxt){
    var est=cargaEstado(info.pedidoId);
    if(est.k==='locked'){ toast('Ese pedido lo esta cargando '+shortName(est.email),'#9a6700'); return; }
    cargaUpsert(info.pedidoId, turno, 'en_curso');
    sessionStorage.setItem('fuesmen_turno',turno); sessionStorage.setItem('fuesmen_meta',metaTxt||'');
    sessionStorage.setItem('fuesmen_autosave','1');
    sessionStorage.setItem('fuesmen_pedidoid', info.pedidoId||'');
    sessionStorage.setItem('fuesmen_turno_n', String(turno));
    info.anchor.click();
  }

  // ===== CARGA EN LOTE de casos SEGUROS =====
  var SAFE_MAP={};
  function safeList(){ return Object.keys(SAFE_MAP).map(function(k){ return SAFE_MAP[k]; }); }
  var REFMAP={};
  function buildSafeIndex(list){
    REFMAP={};
    (list||[]).forEach(function(w){
      var ref=String(w.PedidoMed||''); if(!ref) return;
      if(!REFMAP[ref]) REFMAP[ref]={ turno:String(w.TurnoN), alerta:(w.Alerta==='SI'), meta:((w.Practicas||'').split('|')[0]||'').trim(), count:0 };
      REFMAP[ref].count++;
    });
  }
  function scanSafe(){
    SAFE_MAP={};
    [].slice.call(document.querySelectorAll('[onclick*="informe("]')).forEach(function(a){
      if(a.offsetParent===null) return;
      var tr=a.closest('tr'); if(!tr) return;
      var mId=(a.getAttribute('onclick')||'').match(/informe\((\d+)\)/); if(!mId) return;
      if(REVISAR[mId[1]]) return;
      var est=cargaEstado(mId[1]); if(est.k==='locked'||est.k==='done') return;
      var prtEl=tr.querySelector('[onclick*="prt("]'); var mPrt=prtEl?(prtEl.getAttribute('onclick')||'').match(/prt\((\d+)\)/):null; if(!mPrt) return;
      var ref=mPrt[1]; var r=REFMAP[ref]; if(!r || r.count!==1 || r.alerta) return;
      var txt=tr.innerText||'';
      var mDni=txt.match(/DNI[-\s]?(\d{6,9})/);
      var mPac=txt.match(/DNI[-\s]?[0-9]{6,9}\s*\n?\s*([^\n]+)/);
      var mFec=txt.match(/(\d{2}\/\d{2}\/\d{4})/);
      SAFE_MAP[mId[1]]={ pedidoId:mId[1], turno:r.turno, meta:r.meta, dni:mDni?mDni[1]:'', paciente:mPac?mPac[1].trim():'', pedido:ref, fecha:mFec?mFec[1]:'' };
    });
    updateSafeBtn();
  }
  function queueGet(){ try{ return JSON.parse(localStorage.getItem('fuesmen_queue')||'[]'); }catch(e){ return []; } }
  function queueActive(){ try{ return localStorage.getItem('fuesmen_queue_active')==='1'; }catch(e){ return false; } }
  function updateSafeBtn(){
    var b=document.getElementById('fm-b4'); if(!b) return;
    if(queueActive()){ b.textContent='⛔ Detener carga ('+queueGet().length+')'; b.style.background='#d1242f'; b.disabled=false; b.style.opacity='1'; return; }
    var n=safeList().length;
    b.textContent='✅ Cargar seguros ('+n+')';
    b.style.background=n?'#1a7f37':'#6e7781'; b.disabled=!n; b.style.opacity=n?'1':'.6';
  }
  function showSafeModal(){
    function fk(s){ var m=(s.fecha||'').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m?(+m[3]*10000+ +m[2]*100+ +m[1]):99999999; }
    var list=safeList().sort(function(a,b){ return fk(a)-fk(b); });
    var old=document.getElementById('fm-modal'); if(old) old.remove();
    var ov=document.createElement('div'); ov.id='fm-modal';
    ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
    ov.onclick=function(e){ if(e.target===ov) ov.remove(); };
    var box=document.createElement('div');
    box.style.cssText='background:#fff;max-width:580px;width:92%;max-height:82vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    var head=document.createElement('div'); head.style.cssText='background:#1a7f37;color:#fff;padding:12px 16px;font:800 15px Segoe UI;display:flex;justify-content:space-between;align-items:center';
    var ht=document.createElement('span'); ht.textContent='✅ Casos seguros para cargar ('+list.length+')'; head.appendChild(ht);
    var x=document.createElement('button'); x.textContent='✕'; x.style.cssText='background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer'; x.onclick=function(){ ov.remove(); }; head.appendChild(x);
    var body=document.createElement('div'); body.style.cssText='overflow:auto;padding:10px 16px;flex:1';
    if(!list.length){ body.innerHTML='<div style="color:#57606a;font:500 13px Segoe UI;padding:10px">No hay casos seguros disponibles (libres, tramite completo, turno unico).</div>'; }
    else{
      var tbl=document.createElement('table'); tbl.style.cssText='width:100%;border-collapse:collapse;font:13px Segoe UI';
      var hr=document.createElement('tr'); hr.style.cssText='text-align:left;color:#57606a;border-bottom:2px solid #eee';
      hr.innerHTML='<th style="padding:4px">Fecha</th><th>DNI</th><th>Turno</th><th>Pedido N°</th>'; tbl.appendChild(hr);
      list.forEach(function(s){ var tr=document.createElement('tr'); tr.style.cssText='border-bottom:1px solid #f0f0f0';
        tr.innerHTML='<td style="padding:4px;color:#57606a">'+(s.fecha||'')+'</td><td>'+s.dni+'</td><td style="color:#0a5c28;font-weight:800">'+s.turno+'</td><td style="color:#1f6feb;font-weight:700">'+s.pedido+'</td>';
        tbl.appendChild(tr); });
      body.appendChild(tbl);
    }
    var foot=document.createElement('div'); foot.style.cssText='padding:12px 16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end;align-items:center';
    var warn=document.createElement('span'); warn.style.cssText='flex:1;font:600 11px Segoe UI;color:#9a6700'; warn.textContent='Carga y Guarda cada uno en secuencia.';
    var test=document.createElement('button'); test.textContent='🔍 Probar 3';
    test.style.cssText='font:800 13px Segoe UI;color:#1a7f37;background:#eafbf0;border:2px solid #1a7f37;padding:8px 13px;border-radius:9px;cursor:'+(list.length?'pointer':'default'); test.disabled=!list.length; if(!list.length) test.style.opacity='.6';
    test.onclick=function(){ ov.remove(); startBatch(list.slice(0,3)); };
    var go2=document.createElement('button'); go2.textContent='⚡ Cargar todos ('+list.length+')';
    go2.style.cssText='font:800 14px Segoe UI;color:#fff;background:'+(list.length?'#1a7f37':'#6e7781')+';border:0;padding:10px 18px;border-radius:9px;cursor:'+(list.length?'pointer':'default'); go2.disabled=!list.length;
    go2.onclick=function(){ ov.remove(); startBatch(list); };
    foot.appendChild(warn); foot.appendChild(test); foot.appendChild(go2);
    box.appendChild(head); box.appendChild(body); box.appendChild(foot); ov.appendChild(box); document.body.appendChild(ov);
  }
  function startBatch(list){
    if(!list||!list.length) return;
    var q=list.map(function(s){ return {pedidoId:s.pedidoId, turno:s.turno, meta:s.meta}; });
    try{ localStorage.setItem('fuesmen_queue', JSON.stringify(q)); localStorage.setItem('fuesmen_queue_active','1'); }catch(e){}
    updateSafeBtn();
    toast('Cargando '+q.length+' casos seguros…','#1a7f37');
    processQueue();
  }
  var QUEUE_TRIES=0;
  function processQueue(){
    if(!queueActive()) return;
    var q=queueGet();
    if(!q.length){ try{ localStorage.removeItem('fuesmen_queue_active'); }catch(e){} updateSafeBtn(); toast('✅ Carga en lote terminada.','#1a7f37'); return; }
    var item=q[0];
    var a=document.querySelector('[onclick*="informe('+item.pedidoId+')"]');
    if(!a){ if(QUEUE_TRIES++ < 20){ setTimeout(processQueue, 500); return; } q.shift(); try{ localStorage.setItem('fuesmen_queue', JSON.stringify(q)); }catch(e){} QUEUE_TRIES=0; setTimeout(processQueue, 300); return; }
    QUEUE_TRIES=0;
    q.shift(); try{ localStorage.setItem('fuesmen_queue', JSON.stringify(q)); }catch(e){}
    cargaUpsert(item.pedidoId, item.turno, 'en_curso');
    sessionStorage.setItem('fuesmen_turno', item.turno);
    sessionStorage.setItem('fuesmen_meta', item.meta||'');
    sessionStorage.setItem('fuesmen_autosave','1');
    sessionStorage.setItem('fuesmen_pedidoid', item.pedidoId||'');
    sessionStorage.setItem('fuesmen_turno_n', String(item.turno));
    toast('Lote: turno '+item.turno+' ('+q.length+' restantes)…','#1f6feb');
    a.click();
  }

  // ---- helpers FUESMEN ----
  function weekdayEs(ddmmyyyy){
    var m=(ddmmyyyy||'').match(/(\d{2})\D(\d{2})\D(\d{4})/); if(!m) return '';
    var d=new Date(+m[3], +m[2]-1, +m[1]);
    return ['Domingo','Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'][d.getDay()];
  }
  function hisOpenUrl(hash){ return 'http://his.fuesmen.edu.ar:8180/his/servlet/hturno?0#'+hash; }
  function openHisTurno(t){ window.open(hisOpenUrl('fuesmenTurno='+t),'fuesmenHIS'); }
  function openHisDni(dni,ref){ window.open(hisOpenUrl('fuesmenDni='+dni+'&ref='+encodeURIComponent(ref||'')),'fuesmenHIS'); }

  // ---- Vistas ----
  var soloMatch=false; try{ soloMatch=localStorage.getItem('fuesmen_solomatch')==='1'; }catch(e){}
  var viewRevisar=false;
  var viewHarefield=false; try{ viewHarefield=localStorage.getItem('fuesmen_harefield')==='1'; }catch(e){}
  var viewSinTurno=false;
  var REVISAR={};
  function revSave(){ try{ localStorage.setItem('fuesmen_revisar', JSON.stringify(Object.keys(REVISAR))); }catch(e){} }
  function revCount(){ return Object.keys(REVISAR).length; }
  function sbFetchRevisar(cb){
    sbWithToken(function(t){ if(!t){ cb&&cb(); return; }
      sbReq('GET','/rest/v1/fuesmen_revisar?select=pedido_id', t, null,
        function(d){ var m={}; (d||[]).forEach(function(x){ m[String(x.pedido_id)]=1; }); REVISAR=m; cb&&cb(); },
        function(){ cb&&cb(); }); });
  }
  function revSet(pedidoId, on){
    if(!pedidoId) return; pedidoId=String(pedidoId);
    if(on){ REVISAR[pedidoId]=1; } else { delete REVISAR[pedidoId]; }
    sbWithToken(function(t){ if(!t) return;
      if(on){
        GM_xmlhttpRequest({ method:'POST', url:SB_URL+'/rest/v1/fuesmen_revisar',
          headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t,'Content-Type':'application/json','Prefer':'resolution=ignore-duplicates' },
          data:JSON.stringify([{ pedido_id:pedidoId, usuario_email:sbEmail(), updated_at:new Date().toISOString() }]) });
      } else {
        GM_xmlhttpRequest({ method:'DELETE', url:SB_URL+'/rest/v1/fuesmen_revisar?pedido_id=eq.'+encodeURIComponent(pedidoId),
          headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t } });
      }
    });
  }
  function pedidoId(a){ var m=(a.getAttribute('onclick')||'').match(/informe\((\d+)\)/); return m?m[1]:''; }
  function pedidoRow(a){
    var r=a.closest('tr'); if(r) return r;
    var el=a;
    for(var i=0;i<6 && el;i++){ el=el.parentElement; if(el && /DNI[-\s]?\d/i.test(el.textContent||'') && el.children && el.children.length>=3) return el; }
    return a.parentNode;
  }
  function markRevisar(row, on){
    if(!row) return;
    var marked = row.dataset.fmRev==='1';
    if(on && !marked){
      row.dataset.fmRev='1';
      try{ row.style.outline='2px solid #e0a106'; }catch(e){}
      [].slice.call(row.children).forEach(function(c){ if(c.tagName==='TD') c.style.backgroundColor='#fff8e5'; });
      var cell=row.querySelector('td')||row;
      if(!cell.querySelector('.fm-rev-badge')){
        var b=document.createElement('span'); b.className='fm-rev-badge';
        b.textContent='📌 A REVISAR';
        b.style.cssText='display:inline-block;margin-top:4px;font:800 11px Segoe UI;color:#fff;background:#e0a106;padding:2px 8px;border-radius:6px';
        cell.appendChild(b);
      }
    } else if(!on && marked){
      row.dataset.fmRev='';
      row.style.outline='';
      [].slice.call(row.children).forEach(function(c){ if(c.tagName==='TD') c.style.backgroundColor=''; });
      var ex=row.querySelector('.fm-rev-badge'); if(ex) ex.remove();
    }
  }
  function applyView(announce){
    var anchors=[].slice.call(document.querySelectorAll('[onclick*="informe("]'));
    var shown=0;
    anchors.forEach(function(a){
      var row=pedidoRow(a); if(!row) return;
      var isRev = !!REVISAR[pedidoId(a)];
      var show;
      if(viewHarefield){ show = /HAREFIELD/i.test(row.textContent||'') && !isRev; }
      else if(viewRevisar){ show = isRev; }
      else if(viewSinTurno){ show = !!row.querySelector('.fm-dni-nomatch') || !!row.querySelector('.fm-panel.fm-noturno'); }
      else if(soloMatch){ show = !!row.querySelector('.fm-panel') && !row.querySelector('.fm-noturno') && !isRev; }
      else { show = true; }
      row.style.display = show ? '' : 'none';
      markRevisar(row, show && isRev && !viewRevisar);
      if(show) shown++;
    });
    updateToggleLabels();
    if(announce) toast('Mostrando '+shown+' pedidos', '#0969da');
  }
  function addCargaBadge(row,txt,col){ var cell=row.querySelector('td')||row; var b=document.createElement('span'); b.className='fm-carga'; b.textContent=txt; b.style.cssText='display:inline-block;margin-top:4px;margin-right:6px;font:800 11px Segoe UI;color:#fff;background:'+col+';padding:2px 8px;border-radius:6px'; cell.insertBefore(b, cell.firstChild); }
  function applyCargas(){
    [].slice.call(document.querySelectorAll('[onclick*="informe("]')).forEach(function(a){
      if(a.offsetParent===null) return;
      var row=pedidoRow(a); if(!row) return;
      var id=pedidoId(a); if(!id) return;
      var prev=row.querySelector('.fm-carga'); if(prev) prev.remove();
      var btns=[].slice.call(row.querySelectorAll('.fm-panel button')).filter(function(b){ return /Cargar/i.test(b.textContent||''); });
      var st=cargaEstado(id);
      if(st.k==='done'){ DONE[id]=1; addCargaBadge(row,'✓ Cargado'+(st.email?(' · '+shortName(st.email)):''),'#1a7f37'); btns.forEach(function(b){ b.disabled=true; b.style.opacity='.45'; }); }
      else if(st.k==='locked'){ addCargaBadge(row,'🔒 En curso · '+shortName(st.email),'#9a6700'); btns.forEach(function(b){ b.disabled=true; b.style.opacity='.45'; b.title='Lo esta cargando '+shortName(st.email); }); }
      else if(st.k==='mine'){ addCargaBadge(row,'✋ Lo tenés vos','#1f6feb'); }
    });
    updateSafeBtn();
  }
  function updateToggleLabels(){
    var b1=document.getElementById('fm-b1'), b2=document.getElementById('fm-b2'), b5=document.getElementById('fm-b5');
    if(b1){ b1.textContent=soloMatch?'👁 Ver TODOS':'👁 Solo los que tienen turno'; b1.style.background=soloMatch?'#2ea043':'#1f6feb'; }
    if(b2){ b2.textContent=(viewRevisar?'↩ Volver a la lista':'📌 A revisar')+' ('+revCount()+')'; b2.style.background=viewRevisar?'#9a6700':'#444c56'; }
    if(b5){ var hc=[].slice.call(document.querySelectorAll('[onclick*="informe("]')).filter(function(a){ var r=pedidoRow(a); return r && r.offsetParent!==null && /HAREFIELD/i.test(r.textContent||''); }).length;
      b5.textContent=(viewHarefield?'↩ Ver todas':'🏥 HAREFIELD')+' ('+hc+')'; b5.style.background=viewHarefield?'#8250df':'#6f42c1'; }
    var b6=document.getElementById('fm-b6');
    if(b6){ var sc=[].slice.call(document.querySelectorAll('[onclick*="informe("]')).filter(function(a){ var r=pedidoRow(a); return r && (r.querySelector('.fm-dni-nomatch')||r.querySelector('.fm-panel.fm-noturno')); }).length;
      b6.textContent=(viewSinTurno?'↩ Ver todas':'🚫 SIN TURNO')+' ('+sc+')'; b6.style.background=viewSinTurno?'#a40e26':'#d1242f'; }
  }
  function injectToggle(){
    if(document.getElementById('fm-bar')) return;
    var bar=document.createElement('div'); bar.id='fm-bar';
    bar.style.cssText='position:fixed;top:12px;right:16px;z-index:99999;display:flex;gap:8px;align-items:center';
    var b4=document.createElement('button'); b4.id='fm-b4';
    var b5=document.createElement('button'); b5.id='fm-b5';
    var b1=document.createElement('button'); b1.id='fm-b1';
    var b2=document.createElement('button'); b2.id='fm-b2';
    var b3=document.createElement('button'); b3.id='fm-b3';
    var b6=document.createElement('button'); b6.id='fm-b6';
    var b7=document.createElement('button'); b7.id='fm-b7';
    [b4,b5,b1,b6,b7,b2,b3].forEach(function(b){ b.style.cssText='font:700 13px Segoe UI;color:#fff;border:0;padding:9px 14px;border-radius:8px;cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.3)'; });
    b4.onclick=function(){ if(queueActive()){ try{ localStorage.removeItem('fuesmen_queue_active'); localStorage.removeItem('fuesmen_queue'); }catch(e){} toast('Carga en lote detenida.','#9a6700'); updateSafeBtn(); return; } showSafeModal(); };
    b5.onclick=function(){ viewSinTurno=false; viewHarefield=!viewHarefield; if(viewHarefield){ viewRevisar=false; soloMatch=false; try{localStorage.setItem('fuesmen_solomatch','0');}catch(e){} } try{localStorage.setItem('fuesmen_harefield',viewHarefield?'1':'0');}catch(e){} applyView(true); };
    b1.onclick=function(){ viewSinTurno=false; viewRevisar=false; viewHarefield=false; try{localStorage.setItem('fuesmen_harefield','0');}catch(e){} soloMatch=!soloMatch; try{localStorage.setItem('fuesmen_solomatch',soloMatch?'1':'0');}catch(e){} applyView(true); };
    b2.onclick=function(){ viewSinTurno=false; viewHarefield=false; try{localStorage.setItem('fuesmen_harefield','0');}catch(e){} viewRevisar=!viewRevisar; applyView(true); };
    b6.onclick=function(){ viewHarefield=false; viewRevisar=false; soloMatch=false; try{localStorage.setItem('fuesmen_harefield','0');localStorage.setItem('fuesmen_solomatch','0');}catch(e){} viewSinTurno=!viewSinTurno; applyView(true); };
    b7.textContent='🤖 Anular SIN TURNO'; b7.style.background='#a40e26'; b7.title='Automatiza los SIN TURNO: busca cada DNI ±3 días en FUESMEN y, con tu confirmación, anula en Italiano los que no tengan turno.';
    b7.onclick=function(){ startSinTurnoFlow(); };
    b3.textContent='⬇ Ir al final'; b3.style.background='#444c56';
    b3.onclick=function(){ window.scrollTo({top:document.documentElement.scrollHeight, behavior:'smooth'}); };
    var who=document.createElement('span'); who.style.cssText='font:600 12px Segoe UI;color:#fff;background:#24292f;padding:6px 10px;border-radius:8px'; who.textContent='👤 '+shortName(sbEmail());
    var bx=document.createElement('button'); bx.textContent='Salir'; bx.style.cssText='font:700 12px Segoe UI;color:#fff;background:#6e7781;border:0;padding:9px 12px;border-radius:8px;cursor:pointer';
    bx.onclick=function(){ sbClearSession(); location.reload(); };
    bar.appendChild(b4); bar.appendChild(b5); bar.appendChild(b1); bar.appendChild(b6); bar.appendChild(b7); bar.appendChild(b2); bar.appendChild(b3); bar.appendChild(who); bar.appendChild(bx);
    document.body.appendChild(bar);
    updateToggleLabels(); updateSafeBtn();
  }

  function annotate(){
    if(!Object.keys(DNIMAP).length) return;
    [].slice.call(document.querySelectorAll('[onclick*="informe("]')).forEach(function(a){
      if(a.dataset.fmDone) return;
      if(a.offsetParent===null) return;
      a.dataset.fmDone='1';
      // Pedido N° en TODAS las filas (incl. las "sin turno", antes de cualquier return)
      (function(){
        var prow=pedidoRow(a); if(!prow) return;
        var prtA=prow.querySelector('[onclick*="prt("]'); if(!prtA) return;
        var mp=(prtA.getAttribute('onclick')||'').match(/prt\((\d+)\)/);
        var acc=prtA.closest('td')||prtA.parentNode;
        if(mp && acc && !acc.querySelector('.fm-pedido')){
          var pn=document.createElement('div'); pn.className='fm-pedido';
          pn.style.cssText='font:800 13px Segoe UI;color:#1f6feb;margin-bottom:6px;white-space:nowrap';
          pn.textContent='Pedido N° '+mp[1];
          acc.insertBefore(pn, acc.firstChild);
        }
      })();
      var info=parseRow(a); if(!info||!info.dni) return;
      var cands=bestForRow(info.dni,info.estudio);
      if(!cands.length){
        // Pedido SIN turno asociado en A: ofrecer buscar el DNI en FUESMEN (±3 dias del pedido)
        // para confirmar si el estudio se hizo; si no aparece, el operador lo anula.
        var cellsN=[].slice.call(info.tr.querySelectorAll('td'));
        var pacN=cellsN.filter(function(c){ return /DNI[-\s]?\d/i.test(c.textContent||''); })[0];
        var presN=pacN ? pacN.nextElementSibling : null;
        if(presN && presN.tagName==='TD' && !presN.querySelector('.fm-dni-nomatch')){
          var wN=document.createElement('div'); wN.className='fm-dni-nomatch'; wN.style.cssText='margin-top:8px';
          var nb=document.createElement('button'); nb.textContent='\uD83D\uDD0D DNI '+info.dni+' \u00b7 sin turno';
          nb.title='No hay turno de A asociado. Buscar este DNI en FUESMEN (\u00b13 dias del pedido) para ver si se hizo; si no, anularlo.';
          nb.style.cssText='font:700 12px Segoe UI;color:#fff;background:#d1242f;border:0;padding:6px 11px;border-radius:7px;cursor:pointer';
          nb.onclick=function(){ openHisDni(info.dni, info.fechaPedido); };
          wN.appendChild(nb);
          if(info.pedidoId){
            var rbN=document.createElement('button');
            var rbNl=function(){ rbN.textContent = REVISAR[info.pedidoId] ? '\u2715 Quitar de "a revisar"' : '\uD83D\uDCCC Pendiente revisar'; rbN.style.background = REVISAR[info.pedidoId] ? '#6e7781' : '#9a6700'; };
            rbN.style.cssText='display:block;margin-top:6px;font:700 12px Segoe UI;color:#fff;border:0;padding:6px 12px;border-radius:7px;cursor:pointer';
            rbNl();
            rbN.onclick=function(ev){ ev.preventDefault(); var on=!REVISAR[info.pedidoId]; revSet(info.pedidoId, on); rbNl(); applyView(); };
            wN.appendChild(rbN);
          }
          presN.appendChild(wN);
        }
        return;
      }
      var box=document.createElement('div'); box.className='fm-panel'; box.style.cssText='margin-top:8px;font-family:Segoe UI,sans-serif';
      function panel(bord,bg){ var p=document.createElement('div'); p.style.cssText='display:inline-flex;align-items:center;gap:14px;padding:8px 14px;border:1px solid '+bord+';border-left:4px solid '+bord+';border-radius:8px;background:'+bg+';max-width:560px'; return p; }
      function cargarBtn(color,fn){ var b=document.createElement('button'); b.textContent='Cargar'; b.style.cssText=btnCss(color)+';padding:7px 16px;font-size:13px'; b.onclick=function(ev){ ev.preventDefault(); fn(); }; return b; }
      {
        var top=cands[0], second=cands[1]?cands[1].sc:0;
        var MIN=0.30;
        var strong=(top.sc>=0.5 && (top.sc-second)>=0.2);
        var sole=(cands.length===1 && top.sc>=MIN);
        if(top.sc<=0){
          box.className+=' fm-noturno';
          var p0=panel('#d1242f','#fff5f5');
          var d0=document.createElement('div'); d0.style.cssText='line-height:1.4;font:600 12px Segoe UI;color:#b3261e;max-width:540px';
          d0.textContent='DNI con '+cands.length+' turno(s) en A, ninguno coincide con este estudio. Verificar a mano (puede faltar el turno en el export).';
          p0.appendChild(d0); box.appendChild(p0);
        } else if(strong || sole){
          var t=top.c; var nota=strong?('coincidencia '+Math.round(top.sc*100)+'%'):('unico turno del DNI \u00b7 '+Math.round(top.sc*100)+'% \u2014 verificar');
          var p1=panel('#2ea043','#eafbf0');
          var d1=document.createElement('div'); d1.style.cssText='line-height:1.4';
          var l1=document.createElement('div'); l1.style.cssText='font:600 13px Segoe UI;color:#1a7f37';
          l1.appendChild(document.createTextNode('Turno sugerido: '));
          var tt=document.createElement('span'); tt.textContent=t.turno;
          tt.style.cssText='font-size:17px;color:#0a5c28;font-weight:800;cursor:pointer;text-decoration:underline';
          tt.title='Buscar este turno en FUESMEN';
          tt.onclick=function(){ openHisTurno(t.turno); };
          l1.appendChild(tt);
          var l2=document.createElement('div'); l2.style.cssText='font-size:12px;color:#57606a'; l2.textContent=t.fecha+' · '+nota;
          var l3=document.createElement('div'); l3.style.cssText='font-size:12px;color:#1a7f37;font-weight:600;margin-top:1px'; l3.textContent='📋 '+(t.practicas.join(', ')||'(sin práctica)');
          d1.appendChild(l1); d1.appendChild(l2); d1.appendChild(l3);
          p1.appendChild(d1); p1.appendChild(cargarBtn('#1f6feb', function(){ loadInforme(info,t.turno,t.practicas[0]||''); }));
          box.appendChild(p1);
          if(info.pedidoId){ SIDE_REG[info.pedidoId]={ id:info.pedidoId, kind:'green', dni:info.dni, paciente:info.paciente, turno:t.turno, fecha:info.fechaPedido, info:info,
            load:(function(tt2,mm){ return function(){ loadInforme(info,tt2,mm); }; })(t.turno, t.practicas[0]||'') }; }
        } else {
          var p2=panel('#9a6700','#fff8e5');
          var d2=document.createElement('div'); d2.style.cssText='line-height:1.5';
          d2.innerHTML='<div style="font:600 13px Segoe UI;color:#8a5a00">'+cands.length+' turnos posibles &mdash; elegi el correcto:</div>';
          var sel=document.createElement('select'); sel.style.cssText='font:13px Segoe UI;margin-top:4px;max-width:360px;padding:4px';
          cands.forEach(function(o){ var op=document.createElement('option'); op.value=o.c.turno; op.textContent='Turno '+o.c.turno+'  -  '+o.c.fecha+'  -  '+o.c.practicas.join(', ').slice(0,46); sel.appendChild(op); });
          d2.appendChild(sel);
          p2.appendChild(d2); p2.appendChild(cargarBtn('#9a6700', function(){ var meta=''; cands.forEach(function(o){ if(o.c.turno===sel.value) meta=o.c.practicas[0]||''; }); loadInforme(info,sel.value,meta); }));
          box.appendChild(p2);
          if(info.pedidoId){ SIDE_REG[info.pedidoId]={ id:info.pedidoId, kind:'orange', dni:info.dni, paciente:info.paciente, fecha:info.fechaPedido, info:info, cands:cands, sel:sel,
            load:(function(s,cs){ return function(){ var meta=''; cs.forEach(function(o){ if(o.c.turno===s.value) meta=o.c.practicas[0]||''; }); loadInforme(info,s.value,meta); }; })(sel,cands) }; }
        }
        if(info.pedidoId){
          var rb=document.createElement('button');
          var rbLbl=function(){ rb.textContent = REVISAR[info.pedidoId] ? '✕ Quitar de "a revisar"' : '📌 Pendiente revisar'; rb.style.background = REVISAR[info.pedidoId] ? '#6e7781' : '#9a6700'; };
          rb.style.cssText='display:inline-block;margin-top:8px;font:700 12px Segoe UI;color:#fff;border:0;padding:6px 12px;border-radius:7px;cursor:pointer';
          rbLbl();
          rb.onclick=function(ev){ ev.preventDefault(); var on=!REVISAR[info.pedidoId]; revSet(info.pedidoId, on); rbLbl(); applyView(); };
          box.appendChild(rb);
        }
      }
      var cells=[].slice.call(info.tr.querySelectorAll('td'));
      var diaSem=weekdayEs(info.fechaPedido);
      if(diaSem){
        var dcell=cells.filter(function(c){ return /\d{2}\/\d{2}\/\d{4}/.test(c.textContent||''); })[0];
        if(dcell && !dcell.querySelector('.fm-dia')){
          var ds=document.createElement('div'); ds.className='fm-dia';
          ds.style.cssText='margin-top:6px;font:800 13px Segoe UI;color:#8250df'; ds.textContent=diaSem;
          dcell.appendChild(ds);
        }
      }
      var pacCell=cells.filter(function(c){ return /DNI[-\s]?\d/i.test(c.textContent||''); })[0];
      var presCell=pacCell ? pacCell.nextElementSibling : null;
      if(presCell && presCell.tagName==='TD' && !presCell.querySelector('.fm-dni')){
        var dwrap=document.createElement('div'); dwrap.className='fm-dni'; dwrap.style.cssText='margin-top:8px';
        var dbtn=document.createElement('button'); dbtn.textContent='🔍 DNI '+info.dni;
        dbtn.title='Buscar este DNI en FUESMEN (rango ±3 días de la fecha del pedido)';
        dbtn.style.cssText='font:700 12px Segoe UI;color:#fff;background:#1f6feb;border:0;padding:6px 11px;border-radius:7px;cursor:pointer';
        dbtn.onclick=function(){ openHisDni(info.dni, info.fechaPedido); };
        dwrap.appendChild(dbtn);
        if(cands.some(function(o){ return o.c.alerta; })){
          var fl=document.createElement('div');
          fl.style.cssText='margin-top:6px;font:800 12px Segoe UI;color:#fff;background:#d1242f;display:inline-block;padding:4px 9px;border-radius:6px';
          fl.textContent='🚩 Trámite incompleto';
          dwrap.appendChild(fl);
        }
        var aseg=cands[0] && cands[0].c.aseg;
        if(aseg){
          var asl=document.createElement('div');
          asl.style.cssText='margin-top:6px;font:600 12px Segoe UI;color:#1f2328;background:#fff3bf;border:1px solid #ffe066;padding:4px 9px;border-radius:6px;display:inline-block';
          asl.textContent='Aseguradora: '+aseg;
          dwrap.appendChild(asl);
        }
        var cuenta=cands[0] && cands[0].c.cuenta;
        if(cuenta){
          var cul=document.createElement('div');
          cul.style.cssText='margin-top:6px;font:600 12px Segoe UI;color:#1f2328;background:#e7f5ff;border:1px solid #a5d8ff;padding:4px 9px;border-radius:6px;display:inline-block';
          cul.textContent='Cuenta: '+cuenta;
          dwrap.appendChild(cul);
        }
        presCell.appendChild(dwrap);
      }
      var target=cells.filter(function(c){ return /Pedido/i.test(c.textContent||''); }).sort(function(x,y){ return (y.textContent||'').length-(x.textContent||'').length; })[0];
      if(!target) target=a.closest('td')||a.parentNode;
      target.appendChild(box);
    });
    applyView();
    scanSafe();
    applyCargas();
  }

  // ---- Buscador ----
  function filterB(q){
    q=(q||'').toLowerCase().trim();
    var n=0,tot=0;
    [].slice.call(document.querySelectorAll('tr')).forEach(function(tr){
      var t=tr.innerText||tr.textContent||'';
      if(!/DNI[-\s]?\d/i.test(t)) return;
      tot++;
      var show=!q || t.toLowerCase().indexOf(q)>=0;
      tr.style.display = show?'':'none';
      if(show) n++;
    });
    [].slice.call(document.querySelectorAll('.fm-binput')).forEach(function(i){ if(document.activeElement!==i) i.value=q; });
    [].slice.call(document.querySelectorAll('.fm-bcount')).forEach(function(c){ c.textContent=q?(n+' de '+tot):''; });
  }
  function makeSearchBar(){
    var bar=document.createElement('div'); bar.className='fm-bsearch';
    bar.style.cssText='margin:8px 0;display:flex;gap:10px;align-items:center';
    var inp=document.createElement('input'); inp.className='fm-binput';
    inp.placeholder='🔎 Buscar en esta página por DNI o apellido…';
    inp.style.cssText='flex:1;max-width:480px;font:14px Segoe UI;padding:8px 12px;border:2px solid #2ea043;border-radius:8px';
    inp.oninput=function(){ filterB(inp.value); };
    var lbl=document.createElement('span'); lbl.className='fm-bcount'; lbl.style.cssText='font:12px Segoe UI;color:#57606a';
    bar.appendChild(inp); bar.appendChild(lbl);
    return bar;
  }
  function injectSearch(){
    var cands=[].slice.call(document.querySelectorAll('button,a,input[type=button],input[type=submit]'));
    function find(re){ for(var i=0;i<cands.length;i++){ var t=(cands[i].textContent||cands[i].value||'').trim(); if(re.test(t)) return cands[i]; } return null; }
    var refs=[ find(/Imprimir Pendientes/i), find(/Imprimir Procesados/i) ].filter(Boolean);
    if(!refs.length){ var any=find(/Imprimir/i); if(any) refs=[any]; }
    refs.forEach(function(ref){
      if(ref.previousElementSibling && ref.previousElementSibling.classList && ref.previousElementSibling.classList.contains('fm-bsearch')) return;
      ref.parentNode.insertBefore(makeSearchBar(), ref);
    });
  }

  // ---- MODO 3: HIS FUESMEN (hturno) ----
  function hisInputNear(el){
    var c = el.querySelector && el.querySelector('input'); if(c) return c;
    var sib=el.nextElementSibling, g=0;
    while(sib && g<4){
      if(sib.tagName==='INPUT') return sib;
      var inp=sib.querySelector && sib.querySelector('input[type=text],input:not([type])');
      if(inp) return inp;
      sib=sib.nextElementSibling; g++;
    }
    return null;
  }
  function hisFindField(re, maxLen){
    var els=[].slice.call(document.querySelectorAll('td,th,label,span,div,b'));
    for(var i=0;i<els.length;i++){
      var t=(els[i].textContent||'').replace(/\s+/g,' ').trim();
      if(re.test(t) && t.length<=(maxLen||16)){ var f=hisInputNear(els[i]); if(f) return f; }
    }
    return null;
  }
  function hisSetVal(el,v){ if(!el) return false; el.focus(); el.value=v;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true})); return true; }
  function hpad(n){ return (n<10?'0':'')+n; }
  function hfmt(d){ return hpad(d.getDate())+'/'+hpad(d.getMonth()+1)+'/'+d.getFullYear(); }
  function hisRango(d1,d2){ hisSetVal(hisFindField(/^Hasta/i,12), hfmt(d2)); hisSetVal(hisFindField(/^Desde/i,12), hfmt(d1)); }
  function hisBuscar(msg){
    var btn=document.querySelector('input.ui-button-buscar, input[name="BUTTON7"], input[value="BUSCAR" i]');
    if(!btn){ btn=[].slice.call(document.querySelectorAll('input[type=submit],input[type=SUBMIT],input[type=button],button')).filter(function(b){ return /^\s*buscar\s*$/i.test(b.value||b.textContent||''); })[0]; }
    // Solo click: dispara el AJAX de GeneXus (igual que cuando lo aprieta una persona).
    // NO usar requestSubmit(): fuerza un envio nativo y RECARGA la pagina, lo que rompe el loop SIN TURNO.
    if(btn){ toast(msg,'#0969da'); setTimeout(function(){ btn.click(); }, 300); }
    else { toast('Completado. No encontre BUSCAR; apretalo vos.','#9a6700'); }
  }
  function hisMode(turno){
    var campo=hisFindField(/^N[º°o]?\.?\s*Turno/i, 14);
    if(!campo){ toast('No encontre el campo "N Turno". Pegá a mano (copiado): '+turno,'#9a6700'); return; }
    var doc=document.getElementById('_DOCUMENTOPERSONA'); if(doc) hisSetVal(doc,'');
    hisSetVal(campo, turno); campo.style.cssText+=';outline:3px solid #2ee6d6';
    var hoy=new Date(); var desde=new Date(); desde.setDate(desde.getDate()-179);
    hisRango(desde, hoy);
    hisBuscar('Buscando turno '+turno+'…');
  }
  function hisModeDni(dni, ref){
    var campo=document.getElementById('_DOCUMENTOPERSONA') || hisFindField(/N[º°o]?\.?\s*Doc/i,12) || hisFindField(/Documento/i,14);
    if(!campo){ toast('No encontre el campo Documento en el HIS. DNI: '+dni,'#9a6700'); return; }
    var tno=hisFindField(/^N[º°o]?\.?\s*Turno/i,14); if(tno) hisSetVal(tno,'0');
    hisSetVal(campo, dni); campo.style.cssText+=';outline:3px solid #2ee6d6';
    var m=(ref||'').match(/(\d{2})\D(\d{2})\D(\d{4})/);
    var base=m?new Date(+m[3], +m[2]-1, +m[1]):new Date();
    var d1=new Date(base); d1.setDate(d1.getDate()-3);
    var d2=new Date(base); d2.setDate(d2.getDate()+3);
    hisRango(d1, d2);
    hisBuscar('Buscando DNI '+dni+' (±3 días de '+hfmt(base)+')…');
  }
  var PEDIDOMAP={};
  function buildPedidoMap(list){ PEDIDOMAP={}; (list||[]).forEach(function(w){ if(w && w.TurnoN && w.PedidoMed) PEDIDOMAP[String(w.TurnoN)]=w.PedidoMed; }); }
  function annotateHisGrid(){
    if(!Object.keys(PEDIDOMAP).length) return;
    [].slice.call(document.querySelectorAll('tr')).forEach(function(tr){
      if(tr.dataset.fmHis) return;
      var cells=[].slice.call(tr.querySelectorAll('td')); if(!cells.length) return;
      var turno=null, cell=null;
      for(var i=0;i<cells.length;i++){ var tx=(cells[i].textContent||'').replace(/\s+/g,''); var m=tx.match(/^(\d{6,8})/); if(m && PEDIDOMAP[m[1]]){ turno=m[1]; cell=cells[i]; break; } }
      if(!turno) return;
      tr.dataset.fmHis='1';
      var b=document.createElement('div'); b.className='fm-his-pedido'; b.setAttribute('data-turno',turno);
      b.style.cssText='font:800 12px Segoe UI;color:#0a5c28;background:#eafbf0;border:1px solid #2ea043;padding:2px 7px;border-radius:5px;margin-top:3px;display:inline-block';
      b.textContent='N° Ref: '+PEDIDOMAP[turno];
      cell.appendChild(b);
    });
  }

  // ============================================================
  // ===== SIN TURNO: automatizacion (v7) =======================
  //  A (FUESMEN) busca el DNI +-3 dias del pedido. Si la grilla
  //  vuelve VACIA -> candidato a anular. B (Italiano) muestra el
  //  lote y SOLO anula (baja()) tras confirmacion del operador.
  //  Puente entre ventanas: tabla Supabase fuesmen_sinturno.
  // ============================================================
  function sbStUpsert(rows, cb){
    sbWithToken(function(t){ if(!t){ cb&&cb(false); return; }
      GM_xmlhttpRequest({ method:'POST', url:SB_URL+'/rest/v1/fuesmen_sinturno',
        headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates' },
        data:JSON.stringify(rows),
        onload:function(r){ cb&&cb(r.status>=200&&r.status<300, r); },
        onerror:function(){ cb&&cb(false); } });
    });
  }
  function sbStFetchMine(cb){
    sbWithToken(function(t){ if(!t){ cb&&cb([]); return; }
      var since=new Date(Date.now()-30*60000).toISOString();
      var url=SB_URL+'/rest/v1/fuesmen_sinturno?select=pedido_id,informe_id,dni,fecha_pedido,estado,resultado'
            +'&usuario_email=eq.'+encodeURIComponent(sbEmail())
            +'&updated_at=gte.'+encodeURIComponent(since)+'&order=updated_at.asc';
      GM_xmlhttpRequest({ method:'GET', url:url,
        headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t },
        onload:function(r){ var d=[]; try{ d=JSON.parse(r.responseText)||[]; }catch(e){} cb&&cb(d); },
        onerror:function(){ cb&&cb([]); } });
    });
  }
  function sbStSetEstado(pedidoId, estado, resultado){
    sbWithToken(function(t){ if(!t) return;
      GM_xmlhttpRequest({ method:'PATCH', url:SB_URL+'/rest/v1/fuesmen_sinturno?pedido_id=eq.'+encodeURIComponent(pedidoId),
        headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t,'Content-Type':'application/json','Prefer':'return=minimal' },
        data:JSON.stringify({ estado:estado, resultado:resultado||'', updated_at:new Date().toISOString() }) });
    });
  }

  // ---------- B (Italiano): escaneo + flujo ----------
  function scanSinTurno(){
    var out=[], seen={};
    [].slice.call(document.querySelectorAll('[onclick*="informe("]')).forEach(function(a){
      if(a.offsetParent===null) return;
      var info=parseRow(a); if(!info||!info.tr) return;
      if(!info.tr.querySelector('.fm-dni-nomatch')) return; // SOLO los SIN TURNO reales
      if(!info.dni) return;
      var bj=info.tr.querySelector('[onclick*="baja("]');
      var mb=bj?(bj.getAttribute('onclick')||'').match(/baja\((\d+)\)/):null;
      if(!mb) return; // sin boton de baja -> no se toca
      var bajaId=mb[1];
      if(seen[bajaId]) return; seen[bajaId]=1;
      out.push({ baja_id:bajaId, informe_id:info.pedidoId||'', dni:onlyDigits(info.dni),
                 fecha_pedido:info.fechaPedido||'', paciente:info.paciente||'',
                 estudio:info.estudio||'' });
    });
    return out;
  }
  var ST_ITEMS=[];      // copia local con paciente (NO se sube a Supabase)
  var ST_POLL=null;
  function stItemByPedido(pid){ for(var i=0;i<ST_ITEMS.length;i++){ if(ST_ITEMS[i].baja_id===pid) return ST_ITEMS[i]; } return null; }
  function startSinTurnoFlow(){
    if(ST_POLL){ stShowProgressModal(); return; }
    var items=scanSinTurno();
    if(!items.length){ toast('No hay pedidos SIN TURNO visibles. Activá la vista 🚫 SIN TURNO primero.','#9a6700'); return; }
    var ok=window.confirm('Voy a buscar en FUESMEN '+items.length+' DNI (±3 días de la fecha del pedido).\n\nNO se borra nada todavía: al terminar te muestro cuáles quedaron SIN turno para que confirmes la anulación.\n\nDejá abierta la pestaña de FUESMEN. ¿Empezar?');
    if(!ok) return;
    ST_ITEMS=items;
    var rows=items.map(function(it){ return {
      pedido_id:it.baja_id, informe_id:it.informe_id, dni:it.dni, fecha_pedido:it.fecha_pedido,
      estado:'buscando', resultado:'', usuario_email:sbEmail(), updated_at:new Date().toISOString() }; });
    sbStUpsert(rows, function(success){
      if(!success){ toast('No pude encolar el lote en Supabase. Probá salir y entrar.','#d1242f'); return; }
      try{ window.open('http://his.fuesmen.edu.ar:8180/his/servlet/hturno?0#fuesmenSinTurno=1','fuesmenHIS'); }catch(e){}
      toast('Lote encolado ('+rows.length+'). Buscando en FUESMEN…','#1f6feb');
      stShowProgressModal();
      ST_POLL=setInterval(stPoll, 3000); stPoll();
    });
  }
  function stCounts(jobs){
    var c={buscando:0,vacio:0,con:0,anulado:0,error:0,total:jobs.length};
    jobs.forEach(function(j){ if(j.estado==='buscando')c.buscando++; else if(j.estado==='vacio')c.vacio++;
      else if(j.estado==='con_resultados')c.con++; else if(j.estado==='anulado')c.anulado++; else if(j.estado==='error')c.error++; });
    return c;
  }
  function stPoll(){
    sbStFetchMine(function(jobs){
      // limitar a los del lote actual
      var mine=jobs.filter(function(j){ return stItemByPedido(j.pedido_id); });
      var c=stCounts(mine);
      stUpdateProgress(c);
      if(c.total && c.buscando===0){ clearInterval(ST_POLL); ST_POLL=null; stShowConfirmDelete(mine); }
    });
  }
  function stModalShell(id,title,color){
    var old=document.getElementById(id); if(old) old.remove();
    var ov=document.createElement('div'); ov.id=id;
    ov.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
    var box=document.createElement('div'); box.style.cssText='background:#fff;max-width:620px;width:92%;max-height:84vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    var head=document.createElement('div'); head.style.cssText='background:'+color+';color:#fff;padding:12px 16px;font:800 15px Segoe UI;display:flex;justify-content:space-between;align-items:center';
    var ht=document.createElement('span'); ht.textContent=title; head.appendChild(ht);
    var x=document.createElement('button'); x.textContent='✕'; x.style.cssText='background:transparent;border:0;color:#fff;font-size:18px;cursor:pointer'; x.onclick=function(){ ov.remove(); }; head.appendChild(x);
    box.appendChild(head); ov.appendChild(box); document.body.appendChild(ov);
    return { ov:ov, box:box, head:ht };
  }
  function stShowProgressModal(){
    var s=stModalShell('fm-st-modal','🚫 Buscando SIN TURNO en FUESMEN…','#1f6feb');
    var body=document.createElement('div'); body.id='fm-st-body'; body.style.cssText='padding:16px;font:14px Segoe UI;color:#1f2328'; s.box.appendChild(body);
    var foot=document.createElement('div'); foot.style.cssText='padding:10px 16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:space-between;align-items:center';
    var hint=document.createElement('span'); hint.style.cssText='font:600 11px Segoe UI;color:#9a6700;flex:1';
    hint.textContent='Tené abierta la pestaña de FUESMEN logueada. Podés seguir trabajando; corre en segundo plano.';
    var stop=document.createElement('button'); stop.textContent='⛔ Detener';
    stop.style.cssText='font:800 13px Segoe UI;color:#fff;background:#d1242f;border:0;padding:9px 16px;border-radius:8px;cursor:pointer';
    stop.onclick=function(){ stStopAll(); };
    foot.appendChild(hint); foot.appendChild(stop);
    s.box.appendChild(foot);
    stUpdateProgress(stCounts(ST_ITEMS.map(function(){ return {estado:'buscando'}; })));
  }
  function stStopAll(){
    if(ST_POLL){ clearInterval(ST_POLL); ST_POLL=null; }
    sbWithToken(function(t){ if(!t) return;
      GM_xmlhttpRequest({ method:'PATCH',
        url:SB_URL+'/rest/v1/fuesmen_sinturno?estado=eq.buscando&usuario_email=eq.'+encodeURIComponent(sbEmail()),
        headers:{ 'apikey':SB_KEY,'Authorization':'Bearer '+t,'Content-Type':'application/json','Prefer':'return=minimal' },
        data:JSON.stringify({ estado:'error', resultado:'detenido por usuario', updated_at:new Date().toISOString() }),
        onload:function(){ toast('Búsqueda detenida. No se anuló nada.','#9a6700'); },
        onerror:function(){ toast('No pude avisar al servidor; cerrá la pestaña de FUESMEN para frenar.','#9a6700'); } });
    });
    var m=document.getElementById('fm-st-modal'); if(m) m.remove();
  }
  function stUpdateProgress(c){
    var body=document.getElementById('fm-st-body'); if(!body) return;
    var done=c.total-c.buscando;
    body.innerHTML='<div style="font:700 14px Segoe UI;margin-bottom:8px">Progreso: '+done+' / '+c.total+'</div>'
      +'<div style="height:10px;background:#eee;border-radius:6px;overflow:hidden;margin-bottom:14px"><div style="height:100%;width:'+(c.total?Math.round(done/c.total*100):0)+'%;background:#1f6feb"></div></div>'
      +'<div style="display:flex;gap:18px;flex-wrap:wrap;font:600 13px Segoe UI">'
      +'<span style="color:#1f6feb">🔎 Buscando: '+c.buscando+'</span>'
      +'<span style="color:#d1242f">🗑 Sin turno (anular): '+c.vacio+'</span>'
      +'<span style="color:#1a7f37">✓ Con turno: '+c.con+'</span>'
      +(c.error?'<span style="color:#9a6700">⚠ Error: '+c.error+'</span>':'')
      +'</div>';
  }
  function stShowConfirmDelete(jobs){
    var vacios=jobs.filter(function(j){ return j.estado==='vacio'; });
    var con=jobs.filter(function(j){ return j.estado==='con_resultados'; });
    var errs=jobs.filter(function(j){ return j.estado==='error'; });
    var s=stModalShell('fm-st-modal','🗑 Confirmar anulación ('+vacios.length+')','#d1242f');
    var body=document.createElement('div'); body.style.cssText='overflow:auto;padding:12px 16px;flex:1';
    if(con.length){
      var note=document.createElement('div'); note.style.cssText='background:#eafbf0;border:1px solid #2ea043;border-radius:8px;padding:8px 10px;margin-bottom:10px;font:600 12px Segoe UI;color:#1a7f37';
      note.textContent='ℹ '+con.length+' pedido(s) SÍ tienen turno en FUESMEN (±3 días) aunque faltaban en el export. NO se anulan: revisalos a mano.';
      body.appendChild(note);
    }
    if(errs.length){
      var en=document.createElement('div'); en.style.cssText='background:#fff8e5;border:1px solid #e0a106;border-radius:8px;padding:8px 10px;margin-bottom:10px;font:600 12px Segoe UI;color:#8a5a00';
      en.textContent='⚠ '+errs.length+' no se pudieron leer en FUESMEN. NO se anulan (quedan para revisar a mano).';
      body.appendChild(en);
    }
    if(!vacios.length){ var nd=document.createElement('div'); nd.style.cssText='color:#57606a;font:500 13px Segoe UI;padding:8px'; nd.textContent='No quedó ningún pedido para anular.'; body.appendChild(nd); }
    else {
      var hint=document.createElement('div'); hint.style.cssText='font:600 12px Segoe UI;color:#b3261e;margin-bottom:8px';
      hint.textContent='Estos pedidos NO tienen turno en FUESMEN en ±3 días. Al confirmar se anulan en Italiano (irreversible):';
      body.appendChild(hint);
      var tbl=document.createElement('table'); tbl.style.cssText='width:100%;border-collapse:collapse;font:13px Segoe UI';
      var hr=document.createElement('tr'); hr.style.cssText='text-align:left;color:#57606a;border-bottom:2px solid #eee';
      hr.innerHTML='<th style="padding:4px;width:28px"></th><th>Fecha</th><th>DNI</th><th>Paciente</th><th>Pedido</th>'; tbl.appendChild(hr);
      vacios.forEach(function(j){ var it=stItemByPedido(j.pedido_id)||{};
        var tr=document.createElement('tr'); tr.style.cssText='border-bottom:1px solid #f0f0f0';
        var cb='<td style="padding:4px"><input type="checkbox" class="fm-st-ck" data-pid="'+j.pedido_id+'" checked></td>';
        tr.innerHTML=cb+'<td style="color:#57606a">'+(it.fecha_pedido||'')+'</td><td>'+(it.dni||j.dni)+'</td>'
          +'<td style="color:#1f2328">'+(it.paciente||'')+'</td><td style="color:#1f6feb;font-weight:700">'+(it.estudio||'').slice(0,30)+'</td>';
        tbl.appendChild(tr); });
      body.appendChild(tbl);
    }
    s.box.appendChild(body);
    var foot=document.createElement('div'); foot.style.cssText='padding:12px 16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end;align-items:center';
    var cancel=document.createElement('button'); cancel.textContent='Cerrar (no anular)';
    cancel.style.cssText='font:700 13px Segoe UI;color:#24292f;background:#eaeef2;border:0;padding:9px 14px;border-radius:8px;cursor:pointer';
    cancel.onclick=function(){ s.ov.remove(); };
    var del=document.createElement('button'); del.textContent='🗑 Anular seleccionados';
    del.style.cssText='font:800 14px Segoe UI;color:#fff;background:'+(vacios.length?'#d1242f':'#6e7781')+';border:0;padding:10px 18px;border-radius:9px;cursor:'+(vacios.length?'pointer':'default'); del.disabled=!vacios.length;
    del.onclick=function(){
      var cks=[].slice.call(document.querySelectorAll('.fm-st-ck')).filter(function(c){ return c.checked; });
      var pids=cks.map(function(c){ return c.getAttribute('data-pid'); });
      if(!pids.length){ toast('No seleccionaste ninguno.','#9a6700'); return; }
      if(!window.confirm('Vas a ANULAR '+pids.length+' pedido(s) en Italiano, en tandas de '+ANUL_BATCH+' con confirmación. Es IRREVERSIBLE. ¿Confirmás?')) return;
      s.ov.remove(); anularStart(pids);
    };
    foot.appendChild(cancel); foot.appendChild(del); s.box.appendChild(foot);
  }
  // ---- Anulacion SIN TURNO: cola que SOBREVIVE las recargas (baja() recarga la pagina) ----
  //  Cada baja() hace un postback nativo que recarga el Italiano y borraria el loop en memoria.
  //  Por eso la lista de pedidos a anular vive en localStorage; en cada carga se reanuda sola.
  //  Procesa en tandas de ANUL_BATCH con confirmacion entre tandas y un boton PARAR.
  var ANUL_BATCH=20, ANUL_TRIES=0, ANUL_BUSY=false;
  function anularActive(){ try{ return localStorage.getItem('fuesmen_anular_active')==='1'; }catch(e){ return false; } }
  function anularGet(){ try{ return JSON.parse(localStorage.getItem('fuesmen_anular')||'[]'); }catch(e){ return []; } }
  function anularSet(q){ try{ localStorage.setItem('fuesmen_anular', JSON.stringify(q)); }catch(e){} }
  function anularNum(k,d){ var v; try{ v=parseInt(localStorage.getItem(k),10); }catch(e){ v=NaN; } return isNaN(v)?d:v; }
  function anularSetNum(k,v){ try{ localStorage.setItem(k,String(v)); }catch(e){} }
  function anularStop(msg){ try{ ['fuesmen_anular','fuesmen_anular_active','fuesmen_anular_batchleft','fuesmen_anular_done','fuesmen_anular_total'].forEach(function(k){ localStorage.removeItem(k); }); }catch(e){} var b=document.getElementById('fm-anular-stop'); if(b) b.remove(); if(msg) toast(msg,'#9a6700'); }
  function anularStart(pids){
    anularSet(pids);
    anularSetNum('fuesmen_anular_total', pids.length);
    anularSetNum('fuesmen_anular_done', 0);
    anularSetNum('fuesmen_anular_batchleft', ANUL_BATCH);
    try{ localStorage.setItem('fuesmen_anular_active','1'); }catch(e){}
    anularStopBtn(); anularProcess();
  }
  function anularStopBtn(){
    var b=document.getElementById('fm-anular-stop');
    if(!b){ b=document.createElement('button'); b.id='fm-anular-stop';
      b.style.cssText='position:fixed;left:16px;bottom:16px;z-index:100002;font:800 14px Segoe UI;color:#fff;background:#d1242f;border:0;padding:11px 18px;border-radius:10px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)';
      b.onclick=function(){ anularStop('Anulación detenida ('+anularNum('fuesmen_anular_done',0)+'/'+anularNum('fuesmen_anular_total',0)+').'); };
      document.body.appendChild(b);
    }
    b.textContent='⛔ PARAR anulación ('+anularGet().length+' restantes)';
  }
  function anularPauseDialog(done,total,left){
    var s=stModalShell('fm-anular-pause','✋ Tanda completada','#9a6700');
    var body=document.createElement('div'); body.style.cssText='padding:16px;font:600 14px Segoe UI;color:#1f2328;line-height:1.5';
    body.innerHTML='Anulaste <b>'+done+'</b> de <b>'+total+'</b>. Quedan <b>'+left+'</b>.<br><br>¿Seguir con la próxima tanda de hasta '+ANUL_BATCH+'?';
    s.box.appendChild(body);
    var foot=document.createElement('div'); foot.style.cssText='padding:12px 16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end';
    var stop=document.createElement('button'); stop.textContent='Parar acá'; stop.style.cssText='font:700 13px Segoe UI;color:#24292f;background:#eaeef2;border:0;padding:9px 14px;border-radius:8px;cursor:pointer';
    stop.onclick=function(){ s.ov.remove(); anularStop('Anulación detenida ('+done+'/'+total+').'); };
    var cont=document.createElement('button'); cont.textContent='Continuar tanda'; cont.style.cssText='font:800 14px Segoe UI;color:#fff;background:#d1242f;border:0;padding:10px 18px;border-radius:9px;cursor:pointer';
    cont.onclick=function(){ s.ov.remove(); anularSetNum('fuesmen_anular_batchleft', ANUL_BATCH); anularProcess(); };
    foot.appendChild(stop); foot.appendChild(cont); s.box.appendChild(foot);
  }
  function anularProcess(){
    if(!anularActive() || ANUL_BUSY) return;
    var q=anularGet();
    var done=anularNum('fuesmen_anular_done',0), total=anularNum('fuesmen_anular_total',0);
    if(!q.length){ anularStop(); toast('✅ Anulación terminada ('+done+'/'+total+'). Recargá para ver la lista.','#1a7f37'); return; }
    anularStopBtn();
    var bleft=anularNum('fuesmen_anular_batchleft', ANUL_BATCH);
    if(bleft<=0){ anularPauseDialog(done,total,q.length); return; }
    var pid=q[0];
    var a=document.querySelector('[onclick*="baja('+pid+')"]');
    if(!a){
      if(ANUL_TRIES++ < 12){ setTimeout(anularProcess, 600); return; }
      ANUL_TRIES=0; q.shift(); anularSet(q); sbStSetEstado(pid,'error','no encontrado en Italiano (no se anuló)');
      setTimeout(anularProcess, 200); return;
    }
    ANUL_TRIES=0; ANUL_BUSY=true;
    q.shift(); anularSet(q);
    anularSetNum('fuesmen_anular_batchleft', bleft-1);
    anularSetNum('fuesmen_anular_done', done+1);
    sbStSetEstado(pid,'anulado','baja() ok');
    anularStopBtn();
    toast('Anulando '+pid+' ('+(done+1)+'/'+total+')…','#d1242f');
    a.click(); // recarga la pagina; anularProcess se reanuda al cargar
  }

  // ---------- A (FUESMEN): worker re-entrante ----------
  function hisResultCount(){
    var txt=(document.body.innerText||document.body.textContent||'');
    var mt=txt.match(/(\d+)\s*TURNOS/i);
    var me=txt.match(/(\d+)\s*ESTUDIOS/i);
    if(!mt) return { ok:false };
    var turnos=parseInt(mt[1],10);
    var estudios=me?parseInt(me[1],10):null;
    var vacio=(turnos===0 && (estudios===null || estudios===0));
    return { ok:true, turnos:turnos, estudios:estudios, vacio:vacio };
  }
  function stBannerA(c){
    var bar=document.getElementById('fm-st-banner');
    if(!c){ if(bar) bar.remove(); return; }
    if(!bar){ bar=document.createElement('div'); bar.id='fm-st-banner';
      bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:100002;background:#1f6feb;color:#fff;font:800 14px Segoe UI;padding:10px 16px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.35)';
      document.body.appendChild(bar); }
    var done=c.total-c.buscando;
    bar.textContent='Asistente: buscando SIN TURNO en FUESMEN — '+done+' / '+c.total+' (no cierres esta pestaña)';
  }
  // --- A: worker POSTBACK-reentrante. VERIFICADO en vivo: BUSCAR es <input
  //     type=submit> con POST nativo => RECARGA la pagina. No es AJAX. Por eso
  //     el estado va en sessionStorage: cada carga (1) lee el resultado de la
  //     busqueda anterior y (2) dispara la siguiente, que recarga de nuevo. ---
  var ST_BUSY=false;            // candado sincrono dentro de una misma carga
  var ST_SEARCHING=false;       // ya disparamos BUSCAR; esperar la recarga (se resetea al recargar)
  var ST_JUST_DONE=null;        // id recien marcado en ESTA carga (evita repicarlo antes de que Supabase confirme)
  function sinturnoWorker(){
    if(ST_SEARCHING || ST_BUSY) return;
    // FUESMEN carga la pagina con 8 sub-frames vacios (chat, notificaciones,
    // syngovia, etc.) y Tampermonkey inyecta el userscript en TODOS. El form de
    // busqueda y el contador "X TURNOS" viven SOLO en el documento principal.
    // sessionStorage (fm_st_cur) se comparte entre frames del mismo origen: sin
    // este guard, un frame vacio gana la carrera, no encuentra el contador y
    // marca "error" borrando fm_st_cur antes de que el frame real lea el
    // resultado. => Solo procesa el frame que realmente tiene el formulario.
    if(!document.getElementById('_DOCUMENTOPERSONA')) return;
    ST_BUSY=true;
    var cur=sessionStorage.getItem('fm_st_cur');
    sbStFetchMine(function(jobs){
      var c=stCounts(jobs);
      // (1) Veniamos de una busqueda: la pagina ya recargo con su resultado.
      if(cur){
        try{ sessionStorage.removeItem('fm_st_cur'); }catch(e){}
        var job=null; jobs.forEach(function(j){ if(j.pedido_id===cur) job=j; });
        if(job && job.estado==='buscando'){
          var doc=document.getElementById('_DOCUMENTOPERSONA');
          var docVal=doc?onlyDigits(doc.value):'';
          // FUESMEN NO devuelve el DNI en el campo tras la recarga (vuelve vacio).
          // Por eso solo es "mismatch" real si el campo trae un valor NO vacio y distinto.
          // Si esta vacio, confiamos en la recarga y leemos el contador: hisResultCount()
          // ya valida que la pagina sea una grilla de resultados ("X TURNOS").
          if(!docVal || docVal===onlyDigits(job.dni)){
            var res=hisResultCount();
            if(res.ok){ sbStSetEstado(cur, res.vacio?'vacio':'con_resultados', res.turnos+' turnos / '+(res.estudios==null?'?':res.estudios)+' estudios'); }
            else { sbStSetEstado(cur,'error','sin contador tras la recarga'); }
          } else {
            sbStSetEstado(cur,'error','doc no coincide tras recarga ('+docVal+' vs '+job.dni+')');
          }
        }
        ST_JUST_DONE=cur; stBannerA(c); ST_BUSY=false;
        setTimeout(sinturnoWorker, 250);  // pasar al siguiente (misma carga)
        return;
      }
      // (2) Arrancar la proxima busqueda.
      var pend=jobs.filter(function(j){ return j.estado==='buscando' && j.pedido_id!==ST_JUST_DONE; });
      if(!jobs.length || !pend.length){ stBannerA(null); ST_BUSY=false; return; }
      stBannerA(c);
      var next=pend[0];
      try{ sessionStorage.setItem('fm_st_cur', next.pedido_id); }catch(e){}
      ST_SEARCHING=true; ST_BUSY=false;
      hisModeDni(next.dni, next.fecha_pedido); // setea doc + rango +-3 + click BUSCAR => RECARGA
      // Red de seguridad: si en 15s NO recargo (busqueda no se ejecuto), marcar error y seguir.
      setTimeout(function(){
        if(sessionStorage.getItem('fm_st_cur')===next.pedido_id){
          sbStSetEstado(next.pedido_id,'error','no se pudo ejecutar la busqueda en FUESMEN');
          try{ sessionStorage.removeItem('fm_st_cur'); }catch(e){}
          ST_SEARCHING=false; setTimeout(sinturnoWorker, 400);
        }
      }, 15000);
    });
  }

  var FM_SETUP_DONE=false;   // observer + timers escalonados: una sola vez por carga
  var WL_PAINTED_SIG=null;   // firma de la worklist ya pintada en esta carga
  function startListB(){
    function go(list){
      if(!Array.isArray(list)) list=[list];
      if(queueActive()){ injectToggle(); setTimeout(processQueue, 200); return; }
      buildIndex(list); buildPedidoMap(list); buildSafeIndex(list);
      injectToggle(); annotate();
      if(!FM_SETUP_DONE){
        FM_SETUP_DONE=true;
        [120,350,800,1600,3000].forEach(function(ms){ setTimeout(annotate, ms); });
        if(sessionStorage.getItem('fuesmen_justsaved')==='1'){ sessionStorage.removeItem('fuesmen_justsaved'); [1000,2000].forEach(function(ms){ setTimeout(nextPendingGreen, ms); }); }
        var t1; new MutationObserver(function(){ clearTimeout(t1); t1=setTimeout(annotate, 250); }).observe(document.body,{childList:true,subtree:true});
      }
    }
    injectToggle();
    if(anularActive()){ anularStopBtn(); setTimeout(anularProcess, 700); return; }
    sbFetchUsuarios(function(){});

    // 1) PINTAR YA desde cache (si hay): saca la latencia de red del camino critico.
    var cached=wlCacheGet();
    if(cached && cached.list && cached.list.length){
      WL_PAINTED_SIG = cached.sig || wlSig(cached.list);
      go(cached.list);
      toast('Asistente activo · '+cached.list.length+' turnos · '+shortName(sbEmail()),'#0969da');
    }

    // 2) Refrescar en segundo plano; re-anotar SOLO si la worklist cambio.
    sbFetchWorklist(function(list){
      if(!list){ if(!cached) toast('No pude leer la worklist. ¿Sesión vencida? Probá salir y entrar.','#d1242f'); return; }
      var sig=wlSig(list);
      wlCacheSet(list, sig);
      if(WL_PAINTED_SIG===sig) return;                 // sin cambios: no re-pintar
      if(WL_PAINTED_SIG!==null){ clearAnnotations(); toast('Worklist actualizada · '+list.length+' turnos','#1a7f37'); }
      else { toast('Asistente activo · '+list.length+' turnos · '+shortName(sbEmail()),'#0969da'); }
      WL_PAINTED_SIG=sig;
      go(list);
    });

    sbFetchCargas(applyCargas);
    sbFetchRevisar(function(){ applyView(); });
    setInterval(function(){ sbFetchCargas(applyCargas); sbFetchRevisar(function(){ applyView(); applyCargas(); }); }, 30000);
  }

  function start(){
    showUpdatedOk();
    checkVersion();
    if(/his\.fuesmen\.edu\.ar/i.test(location.host)){
      function runHis(){
        var h=location.hash||'';
        var mt=h.match(/fuesmenTurno=(\d+)/);
        var md=h.match(/fuesmenDni=(\d+)/);
        if(!mt && !md) return;
        try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}
        if(mt){ hisMode(mt[1]); }
        else { var mr=h.match(/ref=([^&]+)/); hisModeDni(md[1], mr?decodeURIComponent(mr[1]):''); }
      }
      window.addEventListener('hashchange', runHis);
      runHis();
      sbFetchWorklist(function(l){ if(l){ buildPedidoMap(l); annotateHisGrid(); } });
      [500,1300,2600].forEach(function(ms){ setTimeout(annotateHisGrid, ms); });
      // v7: loop SIN TURNO (se auto-encadena; el interval solo lo arranca si aparecen jobs)
      sinturnoWorker();
      [900,2200].forEach(function(ms){ setTimeout(sinturnoWorker, ms); });
      setInterval(sinturnoWorker, 4000);
      var ht; new MutationObserver(function(){ clearTimeout(ht); ht=setTimeout(annotateHisGrid,400); }).observe(document.body,{childList:true,subtree:true});
      return;
    }
    var input=document.querySelector('#numero_informe');
    if(input){ fillMode(input); return; }
    if(!/pedido-medico-grupo/i.test(location.pathname)) return;
    sbWithToken(function(t){
      if(t){ enterApp(); }
      else { showLogin(enterApp); }
    });
  }

  // ---- Login UI ----
  function inpCss(){ return 'width:100%;box-sizing:border-box;font:14px Segoe UI;padding:9px 11px;margin-bottom:8px;border:2px solid #d0d7de;border-radius:8px'; }
  function showLogin(cb){
    if(document.getElementById('fm-login')) return;
    var ov=document.createElement('div'); ov.id='fm-login';
    ov.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
    var box=document.createElement('div'); box.style.cssText='background:#fff;padding:22px;border-radius:12px;width:320px;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    var h=document.createElement('div'); h.style.cssText='font:800 16px Segoe UI;color:#1f2328'; h.textContent='Asistente FUESMEN';
    var sub=document.createElement('div'); sub.style.cssText='font:13px Segoe UI;color:#57606a;margin:4px 0 14px'; sub.textContent='Ingresá con tu cuenta';
    var em=document.createElement('input'); em.type='email'; em.placeholder='Email'; em.style.cssText=inpCss();
    var pw=document.createElement('input'); pw.type='password'; pw.placeholder='Contraseña'; pw.style.cssText=inpCss();
    var er=document.createElement('div'); er.style.cssText='color:#d1242f;font:12px Segoe UI;min-height:16px;margin:2px 0 8px';
    var bt=document.createElement('button'); bt.textContent='Entrar'; bt.style.cssText='width:100%;font:700 14px Segoe UI;color:#fff;background:#1f6feb;border:0;padding:10px;border-radius:8px;cursor:pointer';
    function doLogin(){ er.textContent=''; bt.disabled=true; bt.textContent='Entrando…';
      sbLogin(em.value.trim(), pw.value, function(){ ov.remove(); cb && cb(); },
        function(d){ bt.disabled=false; bt.textContent='Entrar'; er.textContent=(d&&(d.error_description||d.msg||d.message))||'No pude entrar. Revisá email y contraseña.'; }); }
    bt.onclick=doLogin;
    pw.addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });
    box.appendChild(h); box.appendChild(sub); box.appendChild(em); box.appendChild(pw); box.appendChild(er); box.appendChild(bt);
    var bc=document.createElement('button'); bc.textContent='Cancelar (usar la página sin asistente)';
    bc.style.cssText='width:100%;font:600 13px Segoe UI;color:#57606a;background:transparent;border:0;padding:8px;margin-top:8px;cursor:pointer;text-decoration:underline';
    bc.onclick=function(){ ov.remove(); };
    box.appendChild(bc);
    ov.appendChild(box); document.body.appendChild(ov); em.focus();
    if(LATEST_VER && verCmp(SCRIPT_VER,LATEST_VER)<0) markLoginOutdated(LATEST_VER);
  }

  function enterApp(){ checkMustChange(function(){ startListB(); }); }
  function checkMustChange(cb){
    sbWithToken(function(t){
      if(!t){ cb(); return; }
      sbReq('GET','/auth/v1/user', t, null,
        function(u){ var mc = u && u.user_metadata && u.user_metadata.must_change; if(mc){ showChangePassword(cb); } else { cb(); } },
        function(){ cb(); });
    });
  }
  function showChangePassword(cb){
    if(document.getElementById('fm-cp')) return;
    var ov=document.createElement('div'); ov.id='fm-cp';
    ov.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,sans-serif';
    var box=document.createElement('div'); box.style.cssText='background:#fff;padding:22px;border-radius:12px;width:340px;box-shadow:0 10px 40px rgba(0,0,0,.4)';
    var h=document.createElement('div'); h.style.cssText='font:800 16px Segoe UI;color:#1f2328'; h.textContent='Creá tu contraseña';
    var sub=document.createElement('div'); sub.style.cssText='font:13px Segoe UI;color:#57606a;margin:4px 0 14px'; sub.textContent='Es tu primer ingreso. Elegí una contraseña nueva (mínimo 6).';
    var p1=document.createElement('input'); p1.type='password'; p1.placeholder='Nueva contraseña'; p1.style.cssText=inpCss();
    var p2=document.createElement('input'); p2.type='password'; p2.placeholder='Repetir contraseña'; p2.style.cssText=inpCss();
    var er=document.createElement('div'); er.style.cssText='color:#d1242f;font:12px Segoe UI;min-height:16px;margin:2px 0 8px';
    var bt=document.createElement('button'); bt.textContent='Guardar contraseña'; bt.style.cssText='width:100%;font:700 14px Segoe UI;color:#fff;background:#1f6feb;border:0;padding:10px;border-radius:8px;cursor:pointer';
    function save(){
      er.textContent='';
      if((p1.value||'').length<6){ er.textContent='Mínimo 6 caracteres.'; return; }
      if(p1.value!==p2.value){ er.textContent='No coinciden.'; return; }
      bt.disabled=true; bt.textContent='Guardando...';
      sbWithToken(function(t){
        if(!t){ er.textContent='Sesión vencida, volvé a entrar.'; bt.disabled=false; bt.textContent='Guardar contraseña'; return; }
        sbReq('PUT','/auth/v1/user', t, { password:p1.value, data:{ must_change:false } },
          function(){ ov.remove(); cb && cb(); },
          function(d){ bt.disabled=false; bt.textContent='Guardar contraseña'; er.textContent=(d&&(d.msg||d.error_description||d.message))||'No se pudo cambiar.'; });
      });
    }
    bt.onclick=save; p2.addEventListener('keydown',function(e){ if(e.key==='Enter') save(); });
    box.appendChild(h); box.appendChild(sub); box.appendChild(p1); box.appendChild(p2); box.appendChild(er); box.appendChild(bt);
    ov.appendChild(box); document.body.appendChild(ov); p1.focus();
  }
  function showUpdatedOk(){
    try{
      var last=localStorage.getItem('fuesmen_lastver');
      if(last && verCmp(last, SCRIPT_VER)<0){
        var bar=document.createElement('div'); bar.id='fm-ok';
        bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:100002;background:#1a7f37;color:#fff;font:800 15px Segoe UI,sans-serif;padding:12px 16px;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 2px 12px rgba(0,0,0,.35)';
        bar.textContent='✓ Asistente actualizado a v'+SCRIPT_VER+'. Ya podés seguir.';
        document.body.appendChild(bar);
        setTimeout(function(){ bar.style.transition='opacity .6s'; bar.style.opacity='0'; setTimeout(function(){ if(bar.parentNode) bar.remove(); },700); }, 6000);
      }
      localStorage.setItem('fuesmen_lastver', SCRIPT_VER);
    }catch(e){}
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
})();
