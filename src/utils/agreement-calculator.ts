/**
 * Hybrid Agreement Rate Calculator for Group Ratings
 * 
 * Rating Scale:
 * - Strongly Agree (特に行きたい) = +2
 * - Agree (行きたい) = +1
 * - Neutral (どちらでもいい) = 0
 * - Disagree (行きたくない) = -1
 * - Strongly Disagree (特に行きたくない) = -2
 */

/**
 * Calculate agreement rate for a single card based on user ratings
 * @param scores Array of rating scores for one card
 * @returns Agreement percentage (0-100)
 */
export function agreementForCard(scores: number[]): number {
  if (scores.length === 0) return 0;
  if (scores.length === 1) return 100;

  // 1. Distance-based agreement calculation
  let totalDistance = 0;
  let pairCount = 0;

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      let distance = Math.abs(scores[i] - scores[j]);
      
      // If one rating is Neutral (0), weight the distance by 0.5
      if (scores[i] === 0 || scores[j] === 0) {
        distance *= 0.5;
      }
      
      totalDistance += distance;
      pairCount++;
    }
  }

  const averageDistance = totalDistance / pairCount;
  const agreementDistance = 1 - (averageDistance / 4);

  // 2. Mode-based agreement calculation
  const scoreCounts = new Map<number, number>();
  scores.forEach(score => {
    scoreCounts.set(score, (scoreCounts.get(score) || 0) + 1);
  });

  const maxCount = Math.max(...scoreCounts.values());
  const agreementMode = maxCount / scores.length;

  // 3. Hybrid agreement calculation
  const agreementHybrid = (agreementDistance + agreementMode) / 2;
  
  // Return as percentage (0-100)
  return Math.max(0, Math.min(100, agreementHybrid * 100));
}

/**
 * Calculate overall agreement rate across all cards
 * @param allCards Array of arrays, each containing rating scores for one card
 * @returns Overall agreement percentage (0-100)
 */
export function agreementOverall(allCards: number[][]): number {
  if (allCards.length === 0) return 0;

  const cardAgreements = allCards.map(scores => agreementForCard(scores));
  const totalAgreement = cardAgreements.reduce((sum, agreement) => sum + agreement, 0);
  
  // 小数点第1位で四捨五入して整数に統一
  return Math.round(totalAgreement / allCards.length);
}

/**
 * Convert category type to numerical score
 * @param category Category type from the application
 * @returns Numerical score (-2 to +2)
 */
export function categoryToScore(category: string): number {
  switch (category) {
    case 'veryWant': return 2;    // 特に行きたい
    case 'want': return 1;        // 行きたい
    case 'neutral': return 0;     // どちらでもいい
    case 'dont': return -1;       // 行きたくない
    case 'veryDont': return -2;   // 特に行きたくない
    default: return 0;
  }
}

/**
 * Convert user selections to card-based rating matrix
 * @param userSelections Array of user selection data
 * @param totalCards Total number of cards
 * @returns Matrix where each row represents ratings for one card
 */
export function convertSelectionsToMatrix(
  userSelections: Array<{
    categories: {
      veryWant: Array<{id: string}>;
      want: Array<{id: string}>;
      neutral: Array<{id: string}>;
      dont: Array<{id: string}>;
      veryDont: Array<{id: string}>;
    };
  }>,
  totalCards: number = 39
): number[][] {
  const cardMatrix: number[][] = [];

  for (let cardIndex = 1; cardIndex <= totalCards; cardIndex++) {
    const cardId = `card${cardIndex}`;
    const cardRatings: number[] = [];

    userSelections.forEach(selection => {
      let found = false;
      
      // Check each category for this card
      for (const [categoryName, cards] of Object.entries(selection.categories)) {
        if (cards.some((card: {id: string}) => card.id === cardId)) {
          cardRatings.push(categoryToScore(categoryName));
          found = true;
          break;
        }
      }
      
      // If card not found in any category, assume neutral
      if (!found) {
        cardRatings.push(0);
      }
    });

    cardMatrix.push(cardRatings);
  }

  return cardMatrix;
}
