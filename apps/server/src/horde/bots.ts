import {
  botAwaySeconds,
  botFreePlaySeconds,
  BotPilot,
  RiderSession,
  type BotPersona,
  type Rand,
  type WorkoutId,
} from "@indoor-bike/game-core/horde";

/** A simulated rider the room drives in-process, as if a client had connected. */
export interface Bot {
  id: string;
  persona: BotPersona;
  /** Riding now: their session and pilot. */
  ride?: { session: RiderSession; pilot: BotPilot; freeLeft: number };
  /** Seconds until they show up again (when not riding). */
  away: number;
}

export interface BotCallbacks {
  arrive(bot: Bot): void;
  leave(bot: Bot): void;
}

/**
 * Lets the bots come and go: each one stays away for a few minutes, then rides a workout it likes (usually the
 * short version) or some free play, and leaves again. When a person shows up and no bot is riding, the next bot
 * comes within half a minute, so nobody has to ride alone.
 */
export class BotDirector {
  readonly bots: Bot[];

  constructor(
    personas: BotPersona[],
    private readonly rand: Rand,
    private readonly callbacks: BotCallbacks,
  ) {
    // Staggered first arrivals: the first one soon after the server starts.
    this.bots = personas.map((persona, i) => ({ id: `bot-${i}`, persona, away: 5 + i * 90 + rand() * 60 }));
  }

  get riding() {
    return this.bots.filter((b) => b.ride);
  }

  /** A person joined: make sure company is on the way. */
  personArrived() {
    if (this.riding.length > 0) return;
    const next = this.bots.reduce((a, b) => (b.away < a.away ? b : a));
    next.away = Math.min(next.away, 10 + this.rand() * 20);
  }

  /** Advances the bots that are away; riding ones are ticked by the room through their session. */
  tick(dt: number) {
    for (const bot of this.bots) {
      if (bot.ride) {
        if (bot.ride.session.free) {
          bot.ride.freeLeft -= dt;
          if (bot.ride.freeLeft <= 0) this.finish(bot);
        }
        continue;
      }
      bot.away -= dt;
      if (bot.away <= 0) this.start(bot);
    }
  }

  /** The bot's input for this tick. */
  input(bot: Bot, dt: number) {
    const ride = bot.ride!;
    return ride.pilot.ride(dt, ride.session.block);
  }

  /** Called by the room when the bot's workout is done (or free play ran out). */
  finish(bot: Bot) {
    if (!bot.ride) return;
    this.callbacks.leave(bot);
    bot.ride = undefined;
    bot.away = botAwaySeconds(this.rand);
  }

  private start(bot: Bot) {
    const likes = bot.persona.likes;
    const workout: WorkoutId = likes[Math.floor(this.rand() * likes.length)]!;
    const short = this.rand() < 0.7;
    bot.ride = {
      session: new RiderSession(bot.persona.ftp, workout, short),
      pilot: new BotPilot(bot.persona, this.rand),
      freeLeft: botFreePlaySeconds(this.rand),
    };
    this.callbacks.arrive(bot);
  }
}
