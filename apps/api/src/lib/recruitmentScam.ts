// Recruitment scams: "Jambojet is hiring cabin crew, pay a KES 3,500 registration fee to
// secure your interview slot". Airlines don't charge applicants, so a page or post that
// names the brand, talks about hiring and asks for a fee is the pattern. Legitimate job
// reposts (job boards, "Jambojet is hiring! Position: Captain") never mention a fee, which
// is what keeps this from firing on them.
//
// A cabin-crew training school advertising its own course fee next to the brand's name
// can still match; that's why the score rule is corroborating weight, not a verdict.

const HIRING =
  /\b(?:recruit\w*|hiring|vacanc(?:y|ies)|jobs?|careers?|cabin\s+crew|flight\s+attendants?|apply|applicants?|interviews?|nafasi\s+za\s+kazi|ajira)\b/i;

const FEE =
  /\b(?:registration|application|training|processing|medical|interview|uniform|clearance|booking|commitment|placement)\s+(?:fees?|charges?)\b|\bfees?\s+of\s+(?:ksh?s?|kes|sh|usd|\$)|\b(?:pay|send|deposit)\s+(?:a\s+)?(?:ksh?s?\.?|kes|sh\.?|usd|\$)\s?\d|\bada\s+ya\s+(?:usajili|mafunzo|maombi)\b/i;

export function asksRecruitmentFee(text: string | null | undefined, brandRoot: string): boolean {
  if (!text) return false;
  if (!text.toLowerCase().replace(/[\s._-]+/g, "").includes(brandRoot)) return false;
  return HIRING.test(text) && FEE.test(text);
}
