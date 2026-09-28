// Guide articles for /guides/<slug>/. Plain facts that hold across seasons; anything that varies by show
// is phrased as "typically" and points readers to the planner, which shows the real times for their dates.
// Section html is trusted, hand-written markup.

export const GUIDES = [
  {
    slug: "two-shows-one-day",
    title: "Can you see two musicals in one day?",
    lead: "Yes, on matinee days. Here's how it works in London and New York.",
    description: "How to see two musicals in one day in the West End or on Broadway: which days have matinees, typical start times, how much time you have between shows, and how to plan it.",
    updated: "2026-09-28",
    intro: "Many theatre fans fit two shows into one day: an afternoon matinee and an evening performance. It works well in both London and New York because the theatres are close together, but only on the days when your chosen shows actually have a matinee.",
    sections: [
      { h: "Which days have matinees?", html: `<p>Matinees are not daily. The pattern differs by city and by show:</p>
<ul><li><b>West End (London):</b> most musicals play a matinee on <b>Saturday</b>, plus usually one midweek matinee, often <b>Wednesday or Thursday</b>. Some shows also play on Sunday.</li>
<li><b>Broadway (New York):</b> matinees are typically on <b>Wednesday, Saturday and Sunday</b>. Many shows have no performance at all on one weekday, often Monday.</li></ul>
<p>Because every show has its own schedule, the real question is not "is there a matinee on Saturday?" but "which of the shows I want have a matinee on the days I'm in town?". That's exactly what the <a href="/">planner</a> checks for your dates.</p>` },
      { h: "How much time is there between the two shows?", html: `<p>Afternoon performances typically start around 2–3pm and evening performances around 7–8pm. A musical usually runs between about two and three hours including the interval, so a matinee tends to finish in the late afternoon.</p>
<p>That normally leaves one to three hours for a meal and the walk to the next theatre. The gap is tighter if the matinee is a long show or starts late, and the evening show starts early, so check the running time on each show page before booking.</p>` },
      { h: "Getting between theatres", html: `<p>In both cities the theatres are concentrated in a small area: London's West End around Covent Garden, Soho, Leicester Square and Shaftesbury Avenue, and Broadway's theatres in Midtown Manhattan around Times Square. Most pairs of theatres are within walking distance of each other, but allow extra time for crowds after a matinee and for bag checks at the door.</p>` },
      { h: "A simple way to plan it", html: `<ol><li>Pick your trip dates in the <a href="/">planner</a>. It lists only the musicals performing on each day.</li>
<li>For each day, choose one matinee (before 5pm) and one evening show.</li>
<li>The planner warns you if you pick the same musical twice, and shows the theatre and address for every choice.</li>
<li>Export the finished plan as a PDF or share it with the people you're travelling with.</li></ol>
<p>Not sure which shows to see? The <a href="/#/helper">Help me choose</a> quiz suggests a shortlist in about a minute.</p>` }
    ],
    faq: [
      { q: "Is it tiring to see two musicals in one day?", a: "It's a long day, often five or six hours in a theatre seat, but many visitors do it. Pairing one big spectacle with a shorter or lighter show makes it easier." },
      { q: "Which day is best for two shows?", a: "Saturday usually has the most matinees in the West End, and Wednesday, Saturday and Sunday on Broadway. The best day depends on which shows you want, so check them for your exact dates." },
      { q: "Can I see the same musical twice in a day?", a: "Nothing stops you, but most people want two different shows. The planner asks you to confirm if you choose the same musical in two slots." }
    ]
  },
  {
    slug: "west-end-theatre-trip",
    title: "How to plan a West End theatre trip",
    lead: "Dates, show times, matinees and booking tips for London musicals.",
    description: "A practical guide to planning a musical-theatre trip to London's West End: choosing shows, typical performance times and matinee days, seeing two shows a day, and booking tickets.",
    updated: "2026-09-28",
    intro: "London's West End has dozens of musicals running at any time, from long-running classics to new shows and limited seasons. A little planning helps you see the shows you most want on the days you're actually there.",
    sections: [
      { h: "1. Start from your dates", html: `<p>Schedules differ from show to show: which evenings they play, which days have a matinee, and when limited runs end. Start with your travel dates and look at what is actually performing each day. The <a href="/">planner</a> does this from live listings, so you only see shows you can really book.</p>` },
      { h: "2. Choose your shows", html: `<p>Browse the <a href="/london/">West End musicals</a> page for short descriptions of each show, or take the <a href="/#/helper">Help me choose</a> quiz, which suggests shows based on who's travelling and what kind of night out you want. Limited runs are worth prioritising, because they may not be there next time.</p>` },
      { h: "3. Typical performance times", html: `<p>Most West End musicals perform in the evening from Monday to Saturday, typically starting around 7:30pm, though some start at 7pm or 7:45pm. Matinees usually start around 2:30pm and are most common on Saturday and one midweek day. A number of shows also perform on Sunday. Always check the exact time on the ticket before you travel.</p>` },
      { h: "4. Fit two shows into a day", html: `<p>On matinee days you can see a matinee and an evening show. See <a href="/guides/two-shows-one-day/">how to see two shows in one day</a> for timing and walking tips.</p>` },
      { h: "5. Booking tickets", html: `<p>Book through the theatre's official site or a reputable ticket seller, and compare the total price including fees. Seating plans with views from different seats can help you choose. Prices vary by day and demand, so midweek performances are often better value than Friday and Saturday evenings. The TKTS booth in Leicester Square sells discounted tickets for some shows.</p>` },
      { h: "6. Keep everything together", html: `<p>Once you've chosen, export your itinerary from the planner as a PDF with every theatre and address, and attach your ticket confirmations so you have booking references to hand on the day.</p>` }
    ],
    faq: [
      { q: "How far ahead should I book West End tickets?", a: "For popular shows and weekend performances, booking several weeks ahead gives the best choice of seats. Midweek performances and less famous shows are often available closer to the date." },
      { q: "Do West End theatres have performances on Sunday?", a: "Some do and many don't. Sunday performances depend on the show, so check your chosen shows for your dates." },
      { q: "Are West End shows suitable for children?", a: "Many are, and several are made with families in mind. Each show page notes whether it's family-friendly, but always check the theatre's own age guidance before booking." }
    ]
  },
  {
    slug: "broadway-theatre-trip",
    title: "How to plan a Broadway theatre trip",
    lead: "Show times, matinee days and booking tips for musicals in New York.",
    description: "A practical guide to planning a Broadway trip in New York: choosing musicals, typical performance times and matinee days, seeing two shows in a day, and booking tickets.",
    updated: "2026-09-28",
    intro: "Broadway's theatres are clustered in Midtown Manhattan around Times Square, which makes it easy to see several shows in one trip. Each show sets its own weekly schedule, so it pays to plan around your dates.",
    sections: [
      { h: "1. Start from your dates", html: `<p>Broadway shows typically give around eight performances a week, but on different days and at different times. Many have one dark day, often Monday. Start with your travel dates in the <a href="/">planner</a>, which lists only the musicals performing on each day.</p>` },
      { h: "2. Choose your shows", html: `<p>Browse the <a href="/new-york/">Broadway musicals</a> page for short descriptions of every show, or use the <a href="/#/helper">Help me choose</a> quiz. Keep an eye on shows with a closing date, and on new productions still in previews.</p>` },
      { h: "3. Typical performance times", html: `<p>Evening performances typically start at 7pm or 8pm, depending on the show and the day of the week. Matinees usually start around 2pm or 3pm and are most common on Wednesday, Saturday and Sunday. Always confirm the exact time on your ticket.</p>` },
      { h: "4. Fit two shows into a day", html: `<p>Wednesdays, Saturdays and Sundays often allow a matinee and an evening show. See <a href="/guides/two-shows-one-day/">how to see two shows in one day</a>.</p>` },
      { h: "5. Booking tickets", html: `<p>Buy through the official ticketing site for the theatre or a reputable seller, and compare prices including fees. Many shows run digital lotteries and rush tickets, and the TKTS booth in Times Square sells discounted same-day tickets for some shows. Midweek performances are often cheaper than weekends.</p>` },
      { h: "6. Keep everything together", html: `<p>Export your itinerary from the planner as a PDF, with theatres and addresses, and share it with the people you're travelling with.</p>` }
    ],
    faq: [
      { q: "Which night are most Broadway shows dark?", a: "Many Broadway shows have no performance on Monday, but not all. Check your chosen shows for your dates." },
      { q: "How early should I arrive at a Broadway theatre?", a: "Arriving 30 minutes before curtain gives time for security checks, finding your seat and picking up a programme." },
      { q: "Can I see two Broadway shows in one day?", a: "Yes, on days when one of your shows has a matinee, typically Wednesday, Saturday or Sunday. The planner shows which combinations work for your dates." }
    ]
  }
];
