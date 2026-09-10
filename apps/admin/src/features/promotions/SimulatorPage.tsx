import { Alert, PageHeader } from '@jecks/ui';
import { SimulatorPanel } from './SimulatorPanel';

/**
 * The simulator on its own page — PRD F-AD-21.
 *
 * The same panel the editor shows, reachable without opening a promotion, because the
 * usual question is "why did this customer not get the discount", not "what does this
 * one rule do".
 */
export function SimulatorPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Simulateur de promotions"
        description="Reconstituez un panier et voyez exactement ce que la boutique lui accorderait."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
        <SimulatorPanel />

        <Alert tone="info" title="Comment lire le résultat">
          <ul className="mt-2 flex list-disc flex-col gap-1.5 ps-4">
            <li>
              Les promotions automatiques s’appliquent sans code : elles apparaissent même si le
              champ des codes est vide.
            </li>
            <li>
              Une promotion non cumulable bloque toutes celles de priorité inférieure. Elles sont
              alors listées comme refusées.
            </li>
            <li>
              Les remises en pourcentage portent sur le total de chaque ligne, jamais sur le prix
              unitaire, ce qui évite les écarts d’arrondi au centime.
            </li>
            <li>
              La wilaya compte : une promotion limitée à certaines wilayas est refusée ailleurs.
            </li>
          </ul>
        </Alert>
      </div>
    </div>
  );
}
