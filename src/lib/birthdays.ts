export interface BirthdayPerson {
  _id: unknown;
  name: string;
  /** YYYY-MM-DD */
  birthDate: string;
}

/**
 * Próximos aniversários a partir de hoje (inclusive), em até `days` dias.
 * Ano ignorado; 29/02 vira 28/02 em ano não bissexto.
 */
export function upcomingBirthdays<T extends BirthdayPerson>(people: T[], today: string, days = 30) {
  const [ty, tm, td] = today.split("-").map(Number);
  const base = Date.UTC(ty, tm - 1, td);
  return people
    .filter((person) => /^\d{4}-\d{2}-\d{2}$/.test(person.birthDate || ""))
    .map((person) => {
      const [by, bm, bd] = person.birthDate.split("-").map(Number);
      const next = (year: number) => {
        const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
        const day = bm === 2 && bd === 29 && !leap ? 28 : bd;
        return Date.UTC(year, bm - 1, day);
      };
      let when = next(ty);
      if (when < base) when = next(ty + 1);
      const daysUntil = Math.round((when - base) / 86_400_000);
      const date = new Date(when).toISOString().slice(0, 10);
      return { ...person, date, daysUntil, age: Number(date.slice(0, 4)) - by };
    })
    .filter((person) => person.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
}
