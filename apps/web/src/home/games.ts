/** The games listed on the hub page. Add a game here and it shows up in its tab. */
export interface GameEntry {
  title: string;
  /** Relative to the hub page. */
  href: string;
  description: string;
  tags: string[];
}

export const offlineGames: GameEntry[] = [
  {
    title: "Zombie Ramp",
    href: "./zombie-ramp/",
    description:
      "A ramp FTP test as a chase: the target rises every minute and a zombie horde runs at that power. Hold it, or they catch you. Ends with your FTP and a .fit/.tcx file for Strava and co.",
    tags: ["FTP test", "ERG or power meter", "15–30 min"],
  },
];

/** Multiplayer games (apps/server). None yet. */
export const onlineGames: GameEntry[] = [];
