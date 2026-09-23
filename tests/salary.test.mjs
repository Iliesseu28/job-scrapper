// node --test tests/  — extraction de la rémunération depuis le texte des annonces.
// Les cas « attendu » viennent d'extraits réels de la base (31/08/2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSalary as extraireSalaire } from '../scoring/salary.mjs';

const cas = [
  ['Salaire : A partir de 50k&euro; &mdash; selon ton niveau', 'dès 50 k€/an'],
  ['Rémunération entre 35k et 40k brut annuel selon expérience', '35–40 k€/an'],
  ['Compensation: €52,000 per year', '52 k€/an'],
  ['salaire indicatif entre 50 K€ et 60 K€ brut annuel (selon profil)', '50–60 k€/an'],
  ['salaire entre 40 000euros et 45 000euros brut annuel', '40–45 k€/an'],
  ['(TJM): 650€/jour Contexte Dans le cadre', 'TJM 650 €'],
  ["(TJM): 500 Contexte : L'équipe", 'TJM 500 €'],
  ['TJM 400 - 450€ Contexte La DSI', 'TJM 400–450 €'],
  ['TJM ≃ à partir de 450€ / selon profil', 'TJM 450 €'],
  ['Salaire : A partir de 70 000&euro; brut annuel', 'dès 70 k€/an'],
  ['Rémunération : Package - 50-70K€ (fixe + variable + véhicule)', '50–70 k€/an'],
  ['58k€', '58 k€/an'],
  ['Rémunération : 45-60k Bureaux : Levallois Perret', '45–60 k€/an'],
  ['salary range for this position is between CHF 106,000 and CHF 125,000', '106–125 kCHF/an'],
  ['Salaire: 65 000 € Pour un grand groupe international', '65 k€/an'],
  ['RÉMUNÉRATION Un fixe annuel brut entre 45 000 € et 60 000 € selon profil', '45–60 k€/an'],
  ["Salaire: jusqu'à 100K fixe + variable déplafonné", 'jusqu’à 100 k€/an'],
  ['Salary range €75–100K gross BSPCE Reports to CTO', '75–100 k€/an'],
  ['Base salary $120k-$150k plus equity', '120–150 k$/an'],
  ['Rémunération : 3 500 € brut mensuel', '3 500 €/mois'],
  ['Rémunération de 2 500 à 3 000 € par mois selon profil', '2 500–3 000 €/mois'],
  ['Product Owner IA - H/F - Entre 65 et 95K', '65–95 k€/an'],
  // rien de fiable à lire
  ['salary + equity in a high-growth startup', null],
  ['Salary: Competitive. Date: 30 Jul 2026', null],
  ['Rémunération selon expérience et grille salariale', null],
  ['We serve 10k users and 3 000 clients across 45 Kubernetes clusters', null],
  ['TJM Ateliers distanciel : 40 participants', null],
  ['Budget de 1 000 € pour le matériel', null],
  ['Créée en 2019, levée de 12 000 000 € en série A', null],
  ['', null],
  [null, null],
];

for (const [texte, attendu] of cas) {
  test(JSON.stringify((texte || '(vide)').slice(0, 60)), () => assert.equal(extraireSalaire(texte), attendu));
}
