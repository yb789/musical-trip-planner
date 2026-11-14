// Sample schedule used only with E2E_LOCAL=1, where the live ticket sites can't be read.
// Same shape as the answer of /api/schedule.
export function sampleSchedule(city, start, end) {
  const london = city === "london";
  const base = london ? "https://www.seatplan.com/london/" : "https://www.seatplan.com/new-york/";
  const list = london
    ? [["Wicked", "Apollo Victoria Theatre", "wicked-tickets"], ["Hamilton", "Victoria Palace Theatre", "hamilton-tickets"], ["The Lion King", "Lyceum Theatre", "the-lion-king-tickets"]]
    : [["Wicked", "Gershwin Theatre", "wicked-broadway-tickets"], ["Hamilton", "Richard Rodgers Theatre", "hamilton-broadway-tickets"], ["The Lion King", "Minskoff Theatre", "the-lion-king-broadway-tickets"]];
  const shows = list.map(([name, venue, slug]) => ({ name, venue, ticketUrl: `${base}${slug}/`, sourceTicketUrl: "", infoUrl: "", kind: "musical" }));
  const schedule = {};
  for (let d = new Date(`${start}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    schedule[d.toISOString().slice(0, 10)] = list.flatMap(([name]) => ["14:30", "19:30"].map(time => [name, time, { from: london ? "£30" : "$59" }]));
  }
  return { city, start, end, refreshedAt: new Date().toISOString(), shows, schedule, sources: ["Sample data for local tests"], concerts: { shows: [], schedule: {} } };
}
