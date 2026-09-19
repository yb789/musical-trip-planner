(() => {
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
  const PDFJS_WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const MAX_PDF_BYTES=15*1024*1024;
  let pdfJsPromise=null;
  let ticketTarget=null;
  let selectedPdfName='';
  let selectedVerification=null;

  const overlay=document.createElement('div');
  overlay.id='ticketConfirmationOverlay';
  overlay.className='overlay hidden';
  overlay.innerHTML=`
    <div class="modal">
      <h2>Ticket confirmation</h2>
      <div id="ticketShowContext" class="ticket-show-context"></div>
      <div class="ticket-modal-note"><b>Private by design:</b> the PDF is read on this device only. The PDF itself is not uploaded to or stored by this website. Only the confirmation/reference number you approve, the PDF filename, and the match result are saved with this itinerary in your browser.</div>
      <div class="field">
        <label for="ticketPdfInput">Confirmation PDF</label>
        <input id="ticketPdfInput" class="ticket-file-input" type="file" accept="application/pdf,.pdf">
      </div>
      <div id="ticketDetectionStatus" class="ticket-detection-status">Choose the ticket confirmation PDF. The planner will try to find the booking/reference number and check whether the PDF appears to belong to this selected performance.</div>
      <div id="ticketMatchResult" class="ticket-match-result neutral">
        <b>Performance check</b>
        <div class="ticket-match-summary">Not checked yet.</div>
      </div>
      <div class="field" style="margin-top:10px">
        <label for="ticketReferenceInput">Confirmation / booking reference</label>
        <input id="ticketReferenceInput" class="ticket-ref-input" type="text" autocomplete="off" placeholder="e.g. ABC123456">
      </div>
      <div class="field" style="margin-top:10px">
        <label for="ticketSeatInput">Seat(s) — optional</label>
        <input id="ticketSeatInput" class="ticket-ref-input" type="text" autocomplete="off" placeholder="e.g. Stalls · Row K · Seats 12–13">
      </div>
      <div id="ticketReferenceError" class="error"></div>
      <div class="actions">
        <button id="ticketCancelBtn" type="button">Cancel</button>
        <button id="ticketRemoveBtn" type="button" class="danger hidden">Remove confirmation</button>
        <button id="ticketSaveBtn" type="button" class="primary">Save confirmation</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function currentChoice(){
    if(!ticketTarget)return null;
    return state.choices?.[ticketTarget.city]?.[ticketTarget.date]?.[ticketTarget.session]||null;
  }

  function cleanRef(value){
    return String(value||'').trim().replace(/^[-:#\s]+|[-:#\s]+$/g,'').slice(0,80);
  }

  function showDetection(message,type=''){
    const el=$('ticketDetectionStatus');
    el.textContent=message;
    el.className='ticket-detection-status'+(type?' '+type:'');
  }

  function normalizeText(value){
    return String(value||'')
      .normalize('NFKD')
      .replace(/\p{M}/gu,'')
      .toLowerCase()
      .replace(/&/g,' and ')
      .replace(/[^a-z0-9]+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  function titleTokens(value,{venue=false}={}){
    const stop=new Set(venue
      ? ['the','a','an','theatre','theater','venue','at','of','and','new','york','london']
      : ['the','a','an','musical','show','on','at','of','and','new','broadway','west','end']);
    return normalizeText(value).split(' ').filter(t=>t&&!stop.has(t));
  }

  function tokenMatch(text,value,options={}){
    const normText=` ${normalizeText(text)} `;
    const tokens=titleTokens(value,options);
    if(!tokens.length)return false;
    if(tokens.length===1){
      const token=tokens[0];
      return token.length<=3?normText.includes(` ${token} `):normText.includes(token);
    }
    const matched=tokens.filter(token=>normText.includes(` ${token} `)||normText.includes(token)).length;
    return matched/tokens.length>=0.72;
  }

  function selectedVenue(choice){
    try{
      if(typeof resolveVenueAndAddress==='function'){
        const loc=resolveVenueAndAddress(choice);
        if(loc?.venue)return loc.venue;
      }
    }catch{}
    const meta=typeof showMeta==='function'?showMeta(choice.name):{};
    return choice.venue||meta?.venue||'';
  }

  function dateMatches(text,date){
    if(!date)return false;
    const d=parseISO(date),day=d.getDate(),month=d.getMonth()+1,year=d.getFullYear();
    const dd=String(day).padStart(2,'0'),mm=String(month).padStart(2,'0');
    const raw=String(text||'').toLowerCase().replace(/\s+/g,' ');
    const numeric=[
      `${year}-${mm}-${dd}`,`${year}/${mm}/${dd}`,
      `${dd}/${mm}/${year}`,`${day}/${month}/${year}`,
      `${mm}/${dd}/${year}`,`${month}/${day}/${year}`,
      `${dd}-${mm}-${year}`,`${mm}-${dd}-${year}`,
      `${dd}.${mm}.${year}`,`${mm}.${dd}.${year}`
    ];
    if(numeric.some(v=>raw.includes(v)))return true;
    const longMonth=d.toLocaleDateString('en-GB',{month:'long'}).toLowerCase();
    const shortMonth=d.toLocaleDateString('en-GB',{month:'short'}).replace('.','').toLowerCase();
    const wordText=normalizeText(text);
    const variants=[
      `${day} ${longMonth} ${year}`,`${longMonth} ${day} ${year}`,
      `${day} ${shortMonth} ${year}`,`${shortMonth} ${day} ${year}`,
      `${day} ${longMonth}`,`${longMonth} ${day}`,
      `${day} ${shortMonth}`,`${shortMonth} ${day}`
    ].map(normalizeText);
    return variants.some(v=>v&&wordText.includes(v));
  }

  function timeMatches(text,time){
    if(!time||!/^\d{2}:\d{2}$/.test(time))return false;
    const [hh,mm]=time.split(':').map(Number);
    const raw=String(text||'').toLowerCase().replace(/\s+/g,' ');
    const h12=hh%12||12,ampm=hh>=12?'pm':'am';
    const min=String(mm).padStart(2,'0');
    const variants=[
      `${String(hh).padStart(2,'0')}:${min}`,
      `${hh}:${min}`,
      `${h12}:${min} ${ampm}`,
      `${h12}:${min}${ampm}`,
      `${h12}.${min} ${ampm}`,
      `${h12}.${min}${ampm}`,
      `${h12}:${min} ${ampm[0]}.m.`,
      ...(mm===0?[`${h12} ${ampm}`,`${h12}${ampm}`]:[])
    ];
    return variants.some(v=>raw.includes(v));
  }

  function verificationLabel(status){
    if(status==='match')return 'Match';
    if(status==='possible')return 'Possible match';
    if(status==='mismatch')return 'Does not appear to match';
    return 'Unable to verify';
  }

  function verificationShort(status){
    if(status==='match')return 'PDF matches selected performance';
    if(status==='possible')return 'Possible PDF match — review';
    if(status==='mismatch')return 'PDF may not match selected performance';
    return 'PDF match not verified';
  }

  function verifyPerformance(text){
    const choice=currentChoice();
    if(!choice||!ticketTarget)return {status:'unverified',checks:{},message:'No selected performance was available to compare.'};
    const cleanName=typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name;
    const venue=selectedVenue(choice);
    const checks={
      show:tokenMatch(text,cleanName),
      date:dateMatches(text,ticketTarget.date),
      time:timeMatches(text,choice.time),
      venue:venue?tokenMatch(text,venue,{venue:true}):false
    };
    const matched=Object.values(checks).filter(Boolean).length;
    const readable=normalizeText(text).length>30;
    let status='unverified';
    if(checks.show&&checks.date&&(checks.time||checks.venue))status='match';
    else if((checks.show&&checks.date)||(checks.show&&checks.time&&checks.venue)||(checks.date&&checks.time&&checks.venue))status='possible';
    else if(readable&&matched<=1)status='mismatch';
    else if(readable&&matched>=2)status='possible';

    const details=[];
    details.push(`${checks.show?'✓':'—'} Show: ${cleanName}`);
    details.push(`${checks.date?'✓':'—'} Date: ${fmt(ticketTarget.date,{day:'numeric',month:'short',year:'numeric'})}`);
    details.push(`${checks.time?'✓':'—'} Time: ${choice.time}`);
    if(venue)details.push(`${checks.venue?'✓':'—'} Venue: ${venue}`);

    const message=status==='match'
      ? 'The PDF strongly matches the selected performance.'
      : status==='possible'
        ? 'Some performance details match, but not enough were found for a strong match. Please review the PDF before saving.'
        : status==='mismatch'
          ? 'The readable PDF does not contain enough matching performance details. It may belong to a different ticket.'
          : 'There was not enough readable information to verify this PDF against the selected performance.';

    return {status,checks,details,message,checkedAt:new Date().toISOString()};
  }

  function renderVerification(verification){
    const box=$('ticketMatchResult');
    if(!verification){
      box.className='ticket-match-result neutral';
      box.innerHTML='<b>Performance check</b><div class="ticket-match-summary">Not checked yet.</div>';
      return;
    }
    const status=verification.status||'unverified';
    const icon=status==='match'?'✓':status==='possible'?'◐':status==='mismatch'?'⚠':'?';
    box.className=`ticket-match-result ${status}`;
    box.innerHTML=`<b>${icon} ${esc(verificationLabel(status))}</b><div class="ticket-match-summary">${esc(verification.message||verificationShort(status))}</div>${Array.isArray(verification.details)?`<div class="ticket-match-checks">${verification.details.map(x=>`<div>${esc(x)}</div>`).join('')}</div>`:''}`;
  }

  async function getPdfJs(){
    if(!pdfJsPromise){
      pdfJsPromise=import(PDFJS_URL).then(mod=>{
        mod.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
        return mod;
      });
    }
    return pdfJsPromise;
  }

  async function extractPdfText(file){
    const pdfjs=await getPdfJs();
    const bytes=new Uint8Array(await file.arrayBuffer());
    const pdf=await pdfjs.getDocument({data:bytes}).promise;
    const pages=[];
    const pageLimit=Math.min(pdf.numPages,30);
    for(let p=1;p<=pageLimit;p++){
      const page=await pdf.getPage(p);
      const content=await page.getTextContent();
      pages.push(content.items.map(item=>item.str||'').join(' '));
    }
    return pages.join('\n');
  }

  function plausibleReference(value){
    const v=cleanRef(value).replace(/\s+/g,'');
    if(v.length<4||v.length>40)return false;
    if(!/[0-9]/.test(v))return false;
    if(/^(19|20)\d{2}[-/]?\d{1,2}[-/]?\d{1,2}$/.test(v))return false;
    if(/^\d{1,2}[:.]\d{2}$/.test(v))return false;
    const blocked=new Set(['0000','1234','12345','123456','2026','10036','10019']);
    return !blocked.has(v.toUpperCase());
  }

  function detectReference(text){
    const normalized=String(text||'').replace(/\s+/g,' ');
    const patterns=[
      /(?:booking|confirmation|reservation)\s*(?:number|no\.?|#|id|code|reference|ref)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{3,39})/ig,
      /(?:order|purchase)\s*(?:number|no\.?|#|id|code|reference|ref)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{3,39})/ig,
      /(?:reference|ref)\s*(?:number|no\.?|#|id|code)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-]{3,39})/ig,
      /(?:confirmation|booking|order)\s*#\s*([A-Z0-9][A-Z0-9\-]{3,39})/ig
    ];
    const candidates=[];
    for(let i=0;i<patterns.length;i++){
      let match;
      while((match=patterns[i].exec(normalized))){
        const value=cleanRef(match[1]);
        if(!plausibleReference(value))continue;
        let score=100-i*10;
        if(/[A-Z]/i.test(value)&&/[0-9]/.test(value))score+=8;
        if(value.length>=6&&value.length<=18)score+=5;
        candidates.push({value,score,index:match.index});
      }
    }
    candidates.sort((a,b)=>b.score-a.score||a.index-b.index);
    return candidates[0]?.value||'';
  }

  // Seat detection: section (Stalls / Orchestra …), row and seat numbers, joined as "Stalls · Row K · Seats 12-13".
  function detectSeat(text){
    const t=String(text||'').replace(/\s+/g,' ');
    const section=(t.match(/\b(front stalls|rear stalls|stalls|dress circle|royal circle|grand circle|upper circle|balcony|orchestra|front mezzanine|rear mezzanine|mezzanine|gallery|slips|circle|loge|box\s?[A-Z0-9]{1,3})\b/i)||[])[1]||'';
    const row=(t.match(/\brow\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Z]{1,2}\b|\d{1,2}\b)/i)||[])[1]||'';
    const seatMatch=t.match(/\bseats?\s*(?:no\.?|number|numbers|#)?\s*[:\-]?\s*([A-Z]{0,2}\s?\d{1,3}(?:\s*(?:-|–|,|&|and|to)\s*[A-Z]{0,2}\s?\d{1,3})*)/i);
    const seats=seatMatch?seatMatch[1].replace(/\s*(-|–|to)\s*/g,'–').replace(/\s*(,|&|and)\s*/g,', ').trim():'';
    const parts=[];
    if(section)parts.push(section.replace(/\s+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()));
    if(row)parts.push(`Row ${row.toUpperCase()}`);
    if(seats)parts.push(`${/[–,]/.test(seats)?'Seats':'Seat'} ${seats.toUpperCase()}`);
    return parts.join(' · ').slice(0,80);
  }

  async function handlePdf(file){
    $('ticketReferenceError').textContent='';
    if(!file)return;
    if(file.size>MAX_PDF_BYTES){
      showDetection('This PDF is larger than 15 MB. Please use a smaller confirmation PDF or enter the booking reference manually.','error');
      $('ticketPdfInput').value='';
      return;
    }
    if(!(file.type==='application/pdf'||/\.pdf$/i.test(file.name))){
      showDetection('Please choose a PDF file.','error');
      $('ticketPdfInput').value='';
      return;
    }
    selectedPdfName=file.name;
    selectedVerification=null;
    renderVerification(null);
    showDetection('Reading the PDF locally and checking it against the selected performance…');
    try{
      const text=await extractPdfText(file);
      const reference=detectReference(text);
      const seat=detectSeat(text);
      if(seat)$('ticketSeatInput').value=seat;
      selectedVerification=text.trim()?verifyPerformance(text):{status:'unverified',checks:{},details:[],message:'This PDF contains no readable text, so the selected performance could not be verified.',checkedAt:new Date().toISOString()};
      renderVerification(selectedVerification);
      if(reference){
        $('ticketReferenceInput').value=reference;
        showDetection(`Confirmation/reference found: ${reference}${seat?` · seat: ${seat}`:''}. Review the reference, the seat and the performance check below, then save if correct.`,'ok');
      }else if(text.trim()){
        showDetection('The PDF was read and checked against the selected performance, but the confirmation number could not be identified confidently. Please type or paste it below.','warn');
      }else{
        showDetection('This appears to be an image-only/scanned PDF. The performance and confirmation number could not be verified automatically. Please check the PDF and enter the reference manually.','warn');
      }
    }catch(error){
      console.error('Ticket PDF reading failed:',error);
      selectedVerification={status:'unverified',checks:{},details:[],message:'The PDF could not be read automatically, so its performance details were not verified.',checkedAt:new Date().toISOString()};
      renderVerification(selectedVerification);
      showDetection('The PDF could not be read automatically. You can still type the confirmation number manually below, but the ticket will be marked as unverified.','warn');
    }
  }

  function openTicketModal(date,session){
    const choice=state.choices?.[state.city]?.[date]?.[session];
    if(!choice)return;
    ticketTarget={city:state.city,date,session};
    selectedPdfName=choice.confirmationFileName||'';
    selectedVerification=choice.confirmationVerification||null;
    const venue=selectedVenue(choice);
    $('ticketShowContext').innerHTML=`<b>${esc(typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name)}</b> · ${esc(choice.time)}<br>${esc(fmt(date))}${venue?`<br>${esc(venue)}`:''}`;
    $('ticketPdfInput').value='';
    $('ticketReferenceInput').value=choice.bookingReference||'';
    $('ticketSeatInput').value=choice.seat||'';
    $('ticketReferenceError').textContent='';
    $('ticketRemoveBtn').classList.toggle('hidden',!choice.bookingReference);
    renderVerification(selectedVerification);
    if(choice.bookingReference){
      showDetection(`Saved confirmation: ${choice.bookingReference}${choice.confirmationFileName?` · processed from ${choice.confirmationFileName}`:''}. You may replace the PDF or edit the reference.`,'ok');
    }else{
      showDetection('Choose the ticket confirmation PDF. The planner will find the booking/reference number and compare the show, date, time, and venue with this selected performance.');
    }
    $('ticketConfirmationOverlay').classList.remove('hidden');
  }

  function closeTicketModal(){
    $('ticketConfirmationOverlay').classList.add('hidden');
    ticketTarget=null;
    selectedPdfName='';
    selectedVerification=null;
  }

  function saveTicketReference(){
    const choice=currentChoice();
    if(!choice)return closeTicketModal();
    const reference=cleanRef($('ticketReferenceInput').value);
    if(!reference){
      $('ticketReferenceError').textContent='Please enter or confirm the booking / confirmation reference.';
      return;
    }
    choice.bookingReference=reference;
    const seat=cleanRef($('ticketSeatInput').value);
    if(seat)choice.seat=seat;else delete choice.seat;
    choice.confirmationFileName=selectedPdfName||choice.confirmationFileName||'';
    choice.confirmationVerification=selectedVerification||choice.confirmationVerification||{
      status:'unverified',checks:{},details:[],message:'The booking reference was saved manually without a PDF performance check.',checkedAt:new Date().toISOString()
    };
    choice.confirmationAddedAt=new Date().toISOString();
    save();
    closeTicketModal();
    renderDay();
    renderCalendar();
  }

  function removeTicketReference(){
    const choice=currentChoice();
    if(choice){
      delete choice.bookingReference;
      delete choice.seat;
      delete choice.confirmationFileName;
      delete choice.confirmationVerification;
      delete choice.confirmationAddedAt;
      save();
    }
    closeTicketModal();
    renderDay();
    renderCalendar();
  }

  function verificationBadge(verification){
    if(!verification)return'';
    const status=verification.status||'unverified';
    const icon=status==='match'?'✓':status==='possible'?'◐':status==='mismatch'?'⚠':'?';
    return `<div class="ticket-match-badge ${status}">${icon} ${esc(verificationShort(status))}</div>`;
  }

  function controlHtml(choice,date,session){
    if(!choice)return'';
    const ref=choice.bookingReference||'';
    if(ref){
      return `<div class="ticket-confirmation-box"><b>🎟 Ticket confirmation</b><div class="ticket-confirmation-ref">Booking reference: ${esc(ref)}</div>${choice.seat?`<div class="ticket-confirmation-seat">Seat: ${esc(choice.seat)}</div>`:''}${verificationBadge(choice.confirmationVerification)}${choice.confirmationFileName?`<div class="ticket-confirmation-file">PDF processed locally: ${esc(choice.confirmationFileName)}</div>`:''}<div class="ticket-confirmation-actions"><button type="button" class="ticket-confirmation-edit" data-date="${date}" data-session="${session}">Review / replace PDF</button><button type="button" class="ticket-confirmation-remove danger" data-date="${date}" data-session="${session}">Remove</button></div></div>`;
    }
    return `<div class="ticket-confirmation-box"><b>🎟 Bought the ticket?</b><div>Add the confirmation PDF to detect the booking/reference number and verify the show, date, time, and venue.</div><div class="ticket-confirmation-actions"><button type="button" class="ticket-confirmation-add" data-date="${date}" data-session="${session}">Add & verify confirmation PDF</button></div></div>`;
  }

  function bindConfirmationButtons(){
    document.querySelectorAll('.ticket-confirmation-add,.ticket-confirmation-edit').forEach(button=>{
      button.onclick=()=>openTicketModal(button.dataset.date,button.dataset.session);
    });
    document.querySelectorAll('.ticket-confirmation-remove').forEach(button=>{
      button.onclick=()=>{
        const choice=state.choices?.[state.city]?.[button.dataset.date]?.[button.dataset.session];
        if(choice){
          delete choice.bookingReference;
          delete choice.seat;
          delete choice.confirmationFileName;
          delete choice.confirmationVerification;
          delete choice.confirmationAddedAt;
          save();renderDay();renderCalendar();
        }
      };
    });
  }

  // The confirmation box lives inside the chosen show's card (next to the ticket buttons); if that card is not
  // in the list (musical unticked in the filter), it falls back to the Matinee/Evening summary at the top.
  function selectedCardColumn(choice){
    if(!choice||typeof CSS==='undefined'||!CSS.escape)return null;
    const pick=document.querySelector(`.pick.selected[data-name="${CSS.escape(choice.name)}"][data-time="${CSS.escape(choice.time||'')}"]`);
    const card=pick&&pick.closest('.show-card');
    return card?card.children[1]||null:null;
  }
  const previousRenderDay=renderDay;
  renderDay=function(){
    previousRenderDay();
    const day=choices()[state.active]||{};
    for(const session of ['matinee','evening']){
      const choice=day[session];
      if(!choice)continue;
      const target=selectedCardColumn(choice)||$(session==='matinee'?'matineeChoice':'eveningChoice');
      if(target)target.insertAdjacentHTML('beforeend',controlHtml(choice,state.active,session));
    }
    bindConfirmationButtons();
  };

  // My calendar: every chosen show shows its confirmation (reference + seat) or an "Add confirmation" button.
  function locateChoice(choice){
    for(const [date,day] of Object.entries(choices())){
      for(const session of ['matinee','evening'])if(day&&day[session]===choice)return {date,session};
    }
    return null;
  }
  if(typeof calendarChoiceHtml==='function'){
    const previousCalendarChoiceHtml=calendarChoiceHtml;
    calendarChoiceHtml=function(icon,choice){
      let html=previousCalendarChoiceHtml(icon,choice);
      if(!choice)return html;
      const where=locateChoice(choice);
      const attrs=where?`data-date="${where.date}" data-session="${where.session}"`:'';
      let extra='';
      if(choice.bookingReference){
        const status=choice.confirmationVerification?.status||'unverified';
        const verifyText=status==='match'?' · ✓ matched':status==='mismatch'?' · ⚠ check ticket':status==='possible'?' · ◐ possible match':'';
        extra=`<div class="calendar-confirmation">🎟 ${esc(choice.bookingReference)}${choice.seat?` · Seat: ${esc(choice.seat)}`:''}${esc(verifyText)}${where?` <button type="button" class="calendar-confirmation-btn" ${attrs} title="Review or replace the confirmation">Edit</button>`:''}</div>`;
      }else if(where){
        extra=`<div class="calendar-confirmation"><button type="button" class="calendar-confirmation-btn" ${attrs}>🎟 Add confirmation</button></div>`;
      }
      if(extra)html=html.replace(/<\/div>\s*$/,extra+'</div>');
      return html;
    };
  }
  function bindCalendarConfirmationButtons(){
    document.querySelectorAll('.calendar-confirmation-btn').forEach(button=>{
      button.onclick=event=>{event.stopPropagation();openTicketModal(button.dataset.date,button.dataset.session);};
    });
  }
  if(typeof renderCalendar==='function'){
    const previousRenderCalendar=renderCalendar;
    renderCalendar=function(){
      previousRenderCalendar();
      bindCalendarConfirmationButtons();
    };
  }

  function choiceForExportRow(row){
    for(const [date,day] of Object.entries(choices())){
      if(fmt(date)!==row.date)continue;
      for(const session of ['matinee','evening']){
        const choice=day?.[session];
        if(!choice)continue;
        const sessionLabel=session==='matinee'?'Matinee / Afternoon':'Evening';
        const cleanName=typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name;
        if(sessionLabel===row.session&&choice.time===row.time&&cleanName===row.musical)return choice;
      }
    }
    return null;
  }

  const previousSelectedRows=selectedRows;
  selectedRows=function(){
    return previousSelectedRows().map(row=>{
      const choice=choiceForExportRow(row);
      const verification=choice?.confirmationVerification;
      return {...row,bookingReference:choice?.bookingReference||'',seat:choice?.seat||'',ticketMatch:verification?verificationLabel(verification.status):''};
    });
  };

  exportExcel=function(){
    const rows=selectedRows();
    if(!rows.length)return alert('There are no selected performances to export.');
    const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Address','Booking Confirmation','Seat','Ticket PDF Check','Ticket Website','Theater / Venue Website'];
    const keys=['city','date','session','time','musical','venue','address','bookingReference','seat','ticketMatch','ticket','theatre'];
    const e=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    let xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Schedule"><Table>`;
    xml+='<Row>'+headers.map(h=>`<Cell><Data ss:Type="String">${e(h)}</Data></Cell>`).join('')+'</Row>';
    for(const row of rows)xml+='<Row>'+keys.map(key=>`<Cell><Data ss:Type="String">${e(row[key])}</Data></Cell>`).join('')+'</Row>';
    xml+='</Table></Worksheet></Workbook>';
    const blob=new Blob([xml],{type:'application/vnd.ms-excel'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`musical-schedule-${state.city}-${state.start}-to-${state.end}.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  exportPdf=function(){
    const rows=selectedRows();
    if(!rows.length)return alert('There are no selected performances to export.');
    const rangeText=typeof tripRangeText==='function'?tripRangeText():`${fmt(state.start)} – ${fmt(state.end)}`;
    $('printReport').innerHTML=`<h1>Musical Trip Schedule</h1><p><b>${esc(cityLabel())}</b><br>${esc(rangeText)}</p><table><thead><tr><th>Date</th><th>Session</th><th>Time</th><th>Musical</th><th>Theater / Venue</th><th>Address</th><th>Booking Confirmation</th><th>Seat</th><th>Ticket PDF Check</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.date)}</td><td>${esc(row.session)}</td><td>${esc(row.time)}</td><td>${esc(row.musical)}</td><td>${esc(row.venue||'')}</td><td>${esc(row.address||'')}</td><td>${esc(row.bookingReference||'')}</td><td>${esc(row.seat||'')}</td><td>${esc(row.ticketMatch||'')}</td></tr>`).join('')}</tbody></table><p style="font-size:9px">Ticket confirmation PDFs are processed locally in the browser and are not stored by this planner. The PDF match check is an automated aid and may be incomplete; users should verify the show, date, time, venue, and booking reference against the original ticket confirmation. Ticket purchases are handled solely by third-party providers.</p>`;
    window.print();
  };

  $('excelBtn').onclick=exportExcel;
  $('pdfBtn').onclick=exportPdf;
  $('ticketPdfInput').onchange=event=>handlePdf(event.target.files?.[0]);
  $('ticketCancelBtn').onclick=closeTicketModal;
  $('ticketSaveBtn').onclick=saveTicketReference;
  $('ticketRemoveBtn').onclick=removeTicketReference;
})();
