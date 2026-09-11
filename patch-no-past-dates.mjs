import fs from 'node:fs';

const jsFile='date-calendar.js';
const cssFile='date-calendar.css';
let js=fs.readFileSync(jsFile,'utf8');
let css=fs.readFileSync(cssFile,'utf8');

if(!js.includes('NO_PAST_DATES_PATCH')){
  js=js.replace(
    "let pendingPlan = null;",
    `let pendingPlan = null;\n\n  // NO_PAST_DATES_PATCH: trip planning is only allowed for today or future dates.\n  function localTodayISO(){\n    const now=new Date();\n    return iso(new Date(now.getFullYear(),now.getMonth(),now.getDate(),12));\n  }\n  function isPastTripDate(date){\n    return String(date||'') < localTodayISO();\n  }`
  );

  js=js.replace(
    "<p class=\"small\">Choose the city, then click a start date and an end date on the calendar. Use the arrows to move to the next or previous month.</p>",
    "<p class=\"small\">Choose the city, then click a start date and an end date on the calendar. Use the arrows to move to the next or previous month. Past dates are unavailable.</p>"
  );

  js=js.replace(
    "$('pickerMonthLabel').textContent = current.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });",
    `$('pickerMonthLabel').textContent = current.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });\n    const todayForNav=parseISO(localTodayISO());\n    const firstAllowedMonth=new Date(todayForNav.getFullYear(),todayForNav.getMonth(),1,12);\n    $('pickerPrev').disabled=current<=firstAllowedMonth;`
  );

  js=js.replace(
    "button.title = fmt(date);",
    `button.title = fmt(date);\n      const past=isPastTripDate(date);\n      if(past){\n        button.classList.add('past-date');\n        button.disabled=true;\n        button.setAttribute('aria-disabled','true');\n        button.title=\`${'${fmt(date)}'} — past date\`;\n      }`
  );

  js=js.replace(
    "button.onclick = () => chooseDate(date);",
    "if(!past) button.onclick = () => chooseDate(date);"
  );

  js=js.replace(
    "function chooseDate(date) {\n    const range = picker.ranges[picker.activePart] || { start: '', end: '' };",
    `function chooseDate(date) {\n    if(isPastTripDate(date)){\n      $('dateError').textContent='Past dates cannot be selected.';\n      return;\n    }\n    $('dateError').textContent='';\n    const range = picker.ranges[picker.activePart] || { start: '', end: '' };`
  );

  js=js.replace(
    "if (ranges.length !== expected) {\n      return { error: `Please choose both a start and end date for ${picker.split ? 'each trip part' : 'the trip'}.` };\n    }",
    `if (ranges.length !== expected) {\n      return { error: \`Please choose both a start and end date for ${'${picker.split ? \'each trip part\' : \'the trip\'}'}.\` };\n    }\n    const today=localTodayISO();\n    if(ranges.some(range=>range.start<today||range.end<today)){\n      return { error: 'Past dates cannot be selected. Please choose today or a future date.' };\n    }`
  );

  js=js.replace(
    "setMonthFromISO(picker.ranges[0]?.start || iso(new Date()));",
    `const today=localTodayISO();\n    const firstUsable=picker.ranges.find(range=>range?.end>=today);\n    const initialMonth=firstUsable?.start&&firstUsable.start>=today?firstUsable.start:today;\n    setMonthFromISO(initialMonth);`
  );
}

if(!css.includes('NO_PAST_DATES_PATCH')){
  css+=`\n/* NO_PAST_DATES_PATCH */\n.picker-day.past-date,.picker-day:disabled{opacity:.35;background:#f1f1f1;color:#777;border-color:#ddd;cursor:not-allowed;box-shadow:none}\n.picker-day.past-date:hover,.picker-day:disabled:hover{border-color:#ddd}\n.range-picker-head button:disabled{opacity:.35;cursor:not-allowed}\n`;
}

fs.writeFileSync(jsFile,js);
fs.writeFileSync(cssFile,css);
console.log('Past dates disabled in trip scheduler.');
