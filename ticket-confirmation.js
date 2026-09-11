(() => {
  const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
  const PDFJS_WORKER_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const MAX_PDF_BYTES=15*1024*1024;
  let pdfJsPromise=null;
  let ticketTarget=null;
  let selectedPdfName='';

  const overlay=document.createElement('div');
  overlay.id='ticketConfirmationOverlay';
  overlay.className='overlay hidden';
  overlay.innerHTML=`
    <div class="modal">
      <h2>Ticket confirmation</h2>
      <div id="ticketShowContext" class="ticket-show-context"></div>
      <div class="ticket-modal-note"><b>Private by design:</b> the PDF is read on this device only. The PDF itself is not uploaded to or stored by this website. Only the confirmation/reference number you approve and the PDF filename are saved with this itinerary in your browser.</div>
      <div class="field">
        <label for="ticketPdfInput">Confirmation PDF</label>
        <input id="ticketPdfInput" class="ticket-file-input" type="file" accept="application/pdf,.pdf">
      </div>
      <div id="ticketDetectionStatus" class="ticket-detection-status">Choose the ticket confirmation PDF. The planner will try to find the booking, confirmation, order, or reference number.</div>
      <div class="field" style="margin-top:10px">
        <label for="ticketReferenceInput">Confirmation / booking reference</label>
        <input id="ticketReferenceInput" class="ticket-ref-input" type="text" autocomplete="off" placeholder="e.g. ABC123456">
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
    const normalized=String(text||'').replace(/[\u00a0\t]+/g,' ').replace(/\s+/g,' ');
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
    showDetection('Reading the PDF locally on this device…');
    try{
      const text=await extractPdfText(file);
      const reference=detectReference(text);
      if(reference){
        $('ticketReferenceInput').value=reference;
        showDetection(`Confirmation/reference found: ${reference}. Check it against the PDF, edit it if necessary, then press Save confirmation.`,'ok');
      }else if(text.trim()){
        showDetection('I could read the PDF, but I could not confidently identify the confirmation number. Please type or paste it in the field below.','warn');
      }else{
        showDetection('This appears to be an image-only/scanned PDF, so no readable text was found. Please type the confirmation number manually.','warn');
      }
    }catch(error){
      console.error('Ticket PDF reading failed:',error);
      showDetection('The PDF could not be read automatically. You can still type the confirmation number manually below.','warn');
    }
  }

  function openTicketModal(date,session){
    const choice=state.choices?.[state.city]?.[date]?.[session];
    if(!choice)return;
    ticketTarget={city:state.city,date,session};
    selectedPdfName=choice.confirmationFileName||'';
    $('ticketShowContext').innerHTML=`<b>${esc(typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name)}</b> · ${esc(choice.time)}<br>${esc(fmt(date))}`;
    $('ticketPdfInput').value='';
    $('ticketReferenceInput').value=choice.bookingReference||'';
    $('ticketReferenceError').textContent='';
    $('ticketRemoveBtn').classList.toggle('hidden',!choice.bookingReference);
    if(choice.bookingReference){
      showDetection(`Saved confirmation: ${choice.bookingReference}${choice.confirmationFileName?` · processed from ${choice.confirmationFileName}`:''}. You may replace the PDF or edit the reference.`,'ok');
    }else{
      showDetection('Choose the ticket confirmation PDF. The planner will try to find the booking, confirmation, order, or reference number.');
    }
    $('ticketConfirmationOverlay').classList.remove('hidden');
  }

  function closeTicketModal(){
    $('ticketConfirmationOverlay').classList.add('hidden');
    ticketTarget=null;
    selectedPdfName='';
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
    choice.confirmationFileName=selectedPdfName||choice.confirmationFileName||'';
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
      delete choice.confirmationFileName;
      delete choice.confirmationAddedAt;
      save();
    }
    closeTicketModal();
    renderDay();
    renderCalendar();
  }

  function controlHtml(choice,date,session){
    if(!choice)return'';
    const ref=choice.bookingReference||'';
    if(ref){
      return `<div class="ticket-confirmation-box"><b>🎟 Ticket confirmation</b><div class="ticket-confirmation-ref">Booking reference: ${esc(ref)}</div>${choice.confirmationFileName?`<div class="ticket-confirmation-file">PDF processed locally: ${esc(choice.confirmationFileName)}</div>`:''}<div class="ticket-confirmation-actions"><button type="button" class="ticket-confirmation-edit" data-date="${date}" data-session="${session}">Edit / replace PDF</button><button type="button" class="ticket-confirmation-remove danger" data-date="${date}" data-session="${session}">Remove</button></div></div>`;
    }
    return `<div class="ticket-confirmation-box"><b>🎟 Bought the ticket?</b><div>Add the confirmation PDF to detect the booking/reference number.</div><div class="ticket-confirmation-actions"><button type="button" class="ticket-confirmation-add" data-date="${date}" data-session="${session}">Add confirmation PDF</button></div></div>`;
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
          delete choice.confirmationFileName;
          delete choice.confirmationAddedAt;
          save();renderDay();renderCalendar();
        }
      };
    });
  }

  const previousRenderDay=renderDay;
  renderDay=function(){
    previousRenderDay();
    const day=choices()[state.active]||{};
    for(const session of ['matinee','evening']){
      const choice=day[session];
      const target=$(session==='matinee'?'matineeChoice':'eveningChoice');
      if(choice&&target)target.insertAdjacentHTML('beforeend',controlHtml(choice,state.active,session));
    }
    bindConfirmationButtons();
  };

  if(typeof calendarChoiceHtml==='function'){
    const previousCalendarChoiceHtml=calendarChoiceHtml;
    calendarChoiceHtml=function(icon,choice){
      let html=previousCalendarChoiceHtml(icon,choice);
      if(choice?.bookingReference){
        const extra=`<div class="calendar-confirmation">🎟 Confirmation: ${esc(choice.bookingReference)}</div>`;
        html=html.replace(/<\/div>\s*$/,extra+'</div>');
      }
      return html;
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
      return {...row,bookingReference:choice?.bookingReference||''};
    });
  };

  exportExcel=function(){
    const rows=selectedRows();
    if(!rows.length)return alert('There are no selected performances to export.');
    const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Address','Booking Confirmation','Ticket Website','Theater / Venue Website'];
    const keys=['city','date','session','time','musical','venue','address','bookingReference','ticket','theatre'];
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
    $('printReport').innerHTML=`<h1>Musical Trip Schedule</h1><p><b>${esc(cityLabel())}</b><br>${esc(rangeText)}</p><table><thead><tr><th>Date</th><th>Session</th><th>Time</th><th>Musical</th><th>Theater / Venue</th><th>Address</th><th>Booking Confirmation</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.date)}</td><td>${esc(row.session)}</td><td>${esc(row.time)}</td><td>${esc(row.musical)}</td><td>${esc(row.venue||'')}</td><td>${esc(row.address||'')}</td><td>${esc(row.bookingReference||'')}</td></tr>`).join('')}</tbody></table><p style="font-size:9px">Ticket confirmation PDFs are processed locally in the browser and are not stored by this planner. Ticket purchases are handled solely by third-party providers. Verify all performance and purchase details before buying or travelling.</p>`;
    window.print();
  };

  $('excelBtn').onclick=exportExcel;
  $('pdfBtn').onclick=exportPdf;
  $('ticketPdfInput').onchange=event=>handlePdf(event.target.files?.[0]);
  $('ticketCancelBtn').onclick=closeTicketModal;
  $('ticketSaveBtn').onclick=saveTicketReference;
  $('ticketRemoveBtn').onclick=removeTicketReference;
})();
