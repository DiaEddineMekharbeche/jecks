import type { RiskFlag as SharedRiskFlag } from '@jecks/shared';

/**
 * COD risk scoring — PRD F-AD-31 and F-ST-44.
 *
 * Cash on delivery has no payment step, so the only cost of a fake order is the
 * courier's trip. A shop that does not screen them pays for every one. This is a
 * heuristic that flags orders for a human to look at, not a gate: refusing an order
 * outright on a score is how a real customer with a shared IP loses their basket.
 *
 * The one hard refusal is the blacklist, which an operator applied deliberately.
 */

export interface RiskSignals {
  /** Delivered orders this phone has behind it. */
  deliveredCount: number;
  /** Deliveries that failed — the strongest single predictor. */
  failedCount: number;
  cancelledCount: number;
  /** Orders placed from this phone in the last twenty-four hours. */
  ordersToday: number;
  /** An identical cart from the same phone inside the duplicate window. */
  duplicateWithinWindow: boolean;
  blacklisted: boolean;
  /** Orders from this IP in the last hour, whatever the phone. */
  ordersFromIpLastHour: number;
  /** Order value, minor units. */
  totalMinor: bigint;
  /** The shop's average order value, minor units; zero when it has no history. */
  averageOrderMinor: bigint;
  /** The phone did not pass the SMS check, when the shop asks for one. */
  phoneUnverified: boolean;
  /** True when the shipping address is too short to find a door with. */
  addressSuspicious: boolean;
}

/** One vocabulary, shared with the admin so every flag has a label. */
export type RiskFlag = SharedRiskFlag;

export interface RiskAssessment {
  /** 0 to 100. Higher is riskier. */
  score: number;
  flags: RiskFlag[];
  /** True when the order must not be created at all. */
  block: boolean;
  /** True when the storefront should demand a captcha before retrying. */
  requireCaptcha: boolean;
}

export interface RiskPolicy {
  maxOrdersPerPhonePerDay: number;
  /** Orders from one IP in an hour before it looks automated. */
  maxOrdersPerIpPerHour: number;
  /** Score at or above which an order is held for a human. */
  reviewThreshold: number;
}

export const DEFAULT_RISK_POLICY: RiskPolicy = {
  maxOrdersPerPhonePerDay: 3,
  maxOrdersPerIpPerHour: 8,
  reviewThreshold: 50,
};

export function assessRisk(
  signals: RiskSignals,
  policy: RiskPolicy = DEFAULT_RISK_POLICY,
): RiskAssessment {
  const flags: RiskFlag[] = [];
  let score = 0;

  if (signals.blacklisted) {
    // Terminal on its own: an operator decided this, and no amount of good history
    // should quietly overturn it.
    return { score: 100, flags: ['BLACKLISTED'], block: true, requireCaptcha: false };
  }

  // Failed deliveries are weighted against the customer's own history rather than
  // counted flat: two failures out of thirty is a bad week, two out of two is a habit.
  const attempts = signals.deliveredCount + signals.failedCount;
  if (signals.failedCount > 0) {
    const failureRate = attempts === 0 ? 1 : signals.failedCount / attempts;
    if (failureRate >= 0.5 && signals.failedCount >= 2) {
      score += 40;
      flags.push('FAILED_HISTORY');
    } else if (signals.failedCount >= 2) {
      score += 20;
      flags.push('FAILED_HISTORY');
    } else if (attempts <= 2) {
      score += 12;
      flags.push('FAILED_HISTORY');
    }
  }

  if (signals.cancelledCount >= 3) {
    score += 12;
    flags.push('MANY_CANCELLATIONS');
  }

  if (signals.duplicateWithinWindow) {
    // Usually a double-tapped button rather than fraud, but an agent should look
    // before two identical parcels go out.
    score += 25;
    flags.push('DUPLICATE_ORDER');
  }

  if (signals.ordersToday >= policy.maxOrdersPerPhonePerDay) {
    score += 30;
    flags.push('ORDER_FLOOD');
  }

  if (signals.ordersFromIpLastHour >= policy.maxOrdersPerIpPerHour) {
    score += 25;
    flags.push('IP_FLOOD');
  }

  // An order several times the shop's average from a phone with no history is the
  // shape of a prank order; the same value from a repeat customer is a good day.
  if (
    signals.averageOrderMinor > 0n &&
    signals.totalMinor > signals.averageOrderMinor * 4n &&
    signals.deliveredCount === 0
  ) {
    score += 20;
    flags.push('UNUSUALLY_LARGE');
  }

  if (signals.phoneUnverified) {
    score += 15;
    flags.push('PHONE_UNVERIFIED');
  }

  if (signals.addressSuspicious) {
    score += 15;
    flags.push('VAGUE_ADDRESS');
  }

  if (attempts === 0) {
    // Informational: a first order is not risky, but an agent reading the flags should
    // know there is no history behind the other signals.
    flags.push('FIRST_ORDER');
  }

  return {
    score: Math.min(score, 100),
    flags,
    block: false,
    // A captcha is asked for on the patterns a script produces, not on a customer's
    // own history: a shopper with two failed deliveries is a person, not a bot.
    requireCaptcha: flags.includes('ORDER_FLOOD') || flags.includes('IP_FLOOD'),
  };
}

/**
 * Whether an address is specific enough to deliver to.
 *
 * Deliberately generous: Algerian addresses are frequently a landmark and a phone
 * number rather than a street and a number, and refusing those would refuse real
 * customers. It only catches the obviously empty.
 */
export function looksVague(address: string | null | undefined): boolean {
  const text = (address ?? '').trim();
  if (text.length < 10) return true;
  // A string with no letters at all is a placeholder, not a place.
  if (!/\p{L}/u.test(text)) return true;
  // The same character repeated is what someone types to get past a required field.
  return /^(.)\1{5,}$/.test(text.replace(/\s/g, ''));
}
