import Link from "next/link";
import styles from "@/app/snap.module.css";
import { LogoMark, Mark, Tick } from "./marks";
import { CountUp } from "./count-up";

/**
 * THE DECK — three tools disagreeing, peeking out from behind one black card
 * with the answer.
 *
 * ═══ WHY A STACK AND NOT A DIAGRAM ═══
 *
 * Every previous hero asked the eye to find a relationship between separate
 * objects — five scattered chips, a screenshot wired to six pills, a row of
 * rows converging. A hand of cards states it without being read: three
 * different numbers for the same week, and one card in front of them that is
 * a different colour because it is a different kind of thing.
 *
 * It is also small enough to sit BESIDE the headline rather than under it,
 * which is the structural move that lets the headline, the call to action and
 * the source rail share one screen.
 *
 * ═══ THREE, NOT FIVE ═══
 *
 * Three disagreeing numbers is the smallest set that reads as "they disagree".
 * Five reads as a list, and a list is something you are asked to work through.
 *
 * The whole stage is a link: it is the most interesting object in the fold and
 * it should go somewhere. Hovering fans the cards apart to show what each tool
 * cannot see — the argument the front card settles.
 */
const CARDS = [
  {
    source: "calendly",
    name: "Calendly",
    label: "booked",
    figure: "41",
    blind: "can't see who showed up",
    depth: 1,
  },
  {
    source: "close",
    name: "Close CRM",
    label: "logged",
    figure: "38",
    blind: "can't see what they cost",
    depth: 2,
  },
  {
    source: "gsheets",
    name: "Google Sheets",
    label: "typed in",
    figure: "44",
    blind: "updated on Fridays",
    depth: 3,
  },
];

const FRONT_SOURCES = ["calendly", "close", "gsheets"];

export function Deck() {
  return (
    <Link className={styles.deck} href="#receipts" aria-label="See how this 41 was built">
      {CARDS.map((card) => (
        <span className={`${styles.deckCard} ${styles[`deckCard${card.depth}`]}`} key={card.source}>
          <span className={styles.deckHead}>
            <Mark source={card.source} size={24} />
            <span className={styles.deckName}>{card.name}</span>
            <span className={styles.deckLabel}>{card.label}</span>
            <span className={styles.deckFigure}>{card.figure}</span>
          </span>
          {/* Only visible once the deck fans out. */}
          <span className={styles.deckBlindRow}>
            <span className={styles.flagDot} aria-hidden />
            <span className={styles.deckBlind}>{card.blind}</span>
          </span>
        </span>
      ))}

      <span className={styles.deckFront}>
        <span className={styles.deckFrontTop}>
          <LogoMark size={22} onDark />
          <span className={styles.deckFrontName}>Namzilabs</span>
          <span className={styles.deckReconciled}>
            <Tick size={16} onDark />
            Reconciled
          </span>
        </span>

        <span className={styles.deckFrontLabel}>Meetings held, last 7 days</span>
        <span className={`${styles.f1} ${styles.deckFrontFigure}`}>
          <CountUp to={41} from={0} delay={1640} duration={520} />
        </span>

        <span className={styles.deckFrontFoot}>
          <span className={styles.deckFrontSub}>123 in · 82 matched · 41 unique</span>
          <span className={styles.deckFrontMarks}>
            {FRONT_SOURCES.map((source) => (
              <span className={styles.deckFrontMarkRing} key={source}>
                <Mark source={source} size={22} radius="50%" />
              </span>
            ))}
          </span>
        </span>
      </span>
    </Link>
  );
}
