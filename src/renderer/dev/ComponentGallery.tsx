import { useState } from 'react';
import { PackageOpen } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '../components/states/states';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Kbd,
  Label,
} from '../components/ui/basic';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/dialog';
import { Money } from '../components/ui/money';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from '../components/ui/radix';
import { toast } from '../components/ui/toast';

/**
 * Revue visuelle du design system. Développement uniquement : ce module n'est importé
 * que derrière `import.meta.env.DEV` et ne figure pas dans le build de production.
 * Les libellés ne sont pas traduits volontairement (outil interne).
 */
export default function ComponentGallery() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <h1 className="text-3xl font-semibold">Galerie des composants</h1>
      <Card>
        <CardHeader>
          <CardTitle>Boutons</CardTitle>
          <CardDescription>Variantes et tailles.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Button>Principal</Button>
          <Button variant="secondary">Secondaire</Button>
          <Button variant="ghost">Discret</Button>
          <Button variant="success">Encaisser</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Supprimer…
          </Button>
          <Button size="xl">Encaisser (F4)</Button>
          <Tooltip content="Infobulle">
            <Button variant="secondary">Survol</Button>
          </Tooltip>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Étiquettes, montants, notifications</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <Badge>Neutre</Badge>
          <Badge tone="success">Encaissé</Badge>
          <Badge tone="warning">Stock bas</Badge>
          <Badge tone="danger">Erreur</Badge>
          <Badge tone="info">Info</Badge>
          <Money amount={1250000} className="text-3xl font-semibold" />
          <Kbd>F2</Kbd>
          <Button variant="secondary" onClick={() => toast.success('Vente enregistrée.')}>
            Toast succès
          </Button>
          <Button variant="secondary" onClick={() => toast.warning('Stock bas.')}>
            Toast alerte
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Échec.')}>
            Toast erreur
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Champs et onglets</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="gallery-input">Nom du produit</Label>
            <Input id="gallery-input" placeholder="Ex. Panneau 400 Wc" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="gallery-switch" aria-label="Interrupteur" />
            <Label htmlFor="gallery-switch">Actif</Label>
          </div>
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Onglet A</TabsTrigger>
              <TabsTrigger value="b">Onglet B</TabsTrigger>
            </TabsList>
            <TabsContent value="a">Contenu A</TabsContent>
            <TabsContent value="b">Contenu B</TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <LoadingState label="Chargement…" />
      <EmptyState
        icon={PackageOpen}
        title="Aucun produit"
        description="Ajoutez votre premier produit pour commencer."
        action={<Button>Ajouter un produit</Button>}
      />
      <ErrorState
        title="Une erreur est survenue"
        message="La lecture a échoué."
        solution="Réessayez."
        retryLabel="Réessayer"
        onRetry={() => toast.info('Nouvel essai.')}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirmer la suppression ?"
        description="Cette action est définitive."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={() => toast.success('Confirmé.')}
      />
    </>
  );
}
