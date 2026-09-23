import { parsePhoneNumberFromString } from 'libphonenumber-js';

/// Normalise n'importe quel format ivoirien accepté par @IsPhoneNumber('CI')
/// (local '07...', avec ou sans espaces, avec ou sans '+225') vers un format
/// E.164 canonique unique ('+2250700000001'). Indispensable pour que deux
/// saisies différentes du même numéro pointent vers le même compte en base
/// (findUnique sur `phone` fait une comparaison stricte de chaîne).
///
/// Ne devrait normalement jamais renvoyer null ici puisque le DTO valide déjà
/// le numéro via @IsPhoneNumber('CI') avant d'atteindre ce code — le null est
/// géré uniquement par prudence défensive.
export function normalizePhone(raw: string): string {
  const parsed = parsePhoneNumberFromString(raw, 'CI');
  return parsed ? parsed.number : raw;
}
