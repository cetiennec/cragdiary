# Registre EPI — ce qui existe, et ce qui a été cherché

État au 21 août 2026. Contrairement à `cragseeker-wip.md`, une bonne partie de
ce document décrit ce qui **est** en production — le registre est jeune, et les
décisions prises en le construisant se perdraient autrement. Les §4 et §5 sont
les enquêtes : les refaire coûterait une demi-journée, alors elles sont écrites.

---

## 1. Ce qui est en production

`/u/<username>/gear`, lié depuis le carnet. **Privé** : 404 pour toute autre
personne, `robots: noindex`. Migration **038** (`gear`, `gear_checks`).

| Élément | Où |
|---|---|
| Modèle, durées de vie, calcul d'état | `src/lib/gear.ts` |
| Page, tri, affichage | `src/app/u/[username]/gear/page.tsx` |
| Ajout | `src/components/GearForm.tsx` |
| Actions (`addGear`, `checkGear`, `retireGear`) | `src/app/actions.ts` |
| Rappels produits | `src/lib/recalls.ts` |

Par équipement : type, marque, modèle, n° de série, **trois dates**
(fabrication, achat, mise en service), notes, réforme (date + motif).
Par contrôle : date, verdict (`ok` / `watch` / `retire`), contrôleur, notes.

**La réforme conserve la ligne.** Un registre dont l'objet est la traçabilité
doit pouvoir dire ce qui était en service l'an dernier, y compris ce qui a
depuis été découpé et jeté. Rien n'est jamais supprimé.

**Le registre consigne des jugements, il n'en rend pas.** C'est la contrainte
qui a dicté le reste : les durées ci-dessous sont les chiffres *habituels* des
fabricants, affichés pour classer par urgence, jamais pour déclarer qu'un
matériel est sûr. La notice fait foi ; le verdict appartient à la personne
compétente qui contrôle, et son nom est enregistré avec.

## 2. Les deux horloges

Le point qui a structuré le modèle de données : un textile vieillit sur **deux
horloges à la fois**, et la première échue l'emporte. C'est pourquoi la mise en
service est un champ à part entière et non un agrément.

| Type | Depuis la fabrication | Depuis la mise en service |
|---|---|---|
| Corde, harnais, casque, sangle, longe, dégaine | 10 ans | 5 ans |
| Mousqueton, assureur, crampons, piolet | — | — |

Le métal n'a pas d'échéance calendaire : il se réforme sur usure, dommage ou
chute sévère. `GEAR_LIFE` dans `lib/gear.ts`.

**Contrôle périodique** : 12 mois (EN 365 demande « au moins une fois par an »
par une personne compétente). L'échéance se compte depuis le dernier contrôle,
**ou à défaut depuis la mise en service** — jamais contrôlé est aussi en retard
que contrôlé il y a treize mois.

Les états, du plus urgent au moins : `expired`, `check-overdue`, `expiring`,
`check-due`, `watch`, `in-service`, `retired`. La liste est triée dans cet
ordre et le bord gauche de chaque carte porte la couleur correspondante.

## 3. Rappels produits — RappelConso

**Trouvé, branché, vérifié.** La DGCCRF publie tous les rappels déclarés en
France en open data : gratuit, sans clé, mis à jour chaque semaine, avec les
codes GTIN depuis la V2.

```
https://data.economie.gouv.fr/api/records/1.0/search/
  ?dataset=rappelconso-v2-gtin-trie&q=<marque>&rows=20
```

Et cette base contient bien du matériel d'escalade. L'exemple sur lequel tout a
été testé :

> **beal — sunrise 9.2mm 50m**, publié le 22/10/2025, lot `a01235824`, code-barres
> `3700288285737` : « le lot ne répondait pas aux exigences relatives au nombre
> de chutes de la norme EN 892 ».

Marque, modèle, lot, code-barres, motif : exactement ce qu'un registre détient
sur le même objet.

**Comment c'est branché.** Une requête par marque (pas par équipement : un
registre contient une poignée de marques et beaucoup de mousquetons), mise en
cache 24 h côté Next. Le rapprochement se fait sur la marque **exacte** — la
recherche plein texte de l'API remonterait sinon un réchaud « Camp » — puis de
façon **lâche** sur le modèle, mot à mot : « Sunrise 9.2 » doit retrouver
« sunrise 9.2mm 50m ». Accents, casse et espaces sont retirés des deux côtés,
et de la requête sortante.

**Ce n'est jamais un verdict.** L'encart dit « rappel produit *possible* » :
seul le numéro de lot inscrit sur le matériel tranche.

**Limites.** France seulement. L'équivalent européen, [Safety Gate
(ex-RAPEX)](https://data.europa.eu/data/datasets/rapex-rapid-alert-system-non-food),
couvre 31 pays mais ne publie que des rapports hebdomadaires, sans API — c'est
la prochaine porte si le besoin dépasse la France. Aux États-Unis, la CPSC
expose une API de rappels.

## 4. Catalogue de matériel — enquête

**Décision (21 août 2026) : pas de catalogue maison.** Une première version en
contenait un (liste de ~50 modèles dans le code + table alimentée par les
saisies) ; elle a été retirée avant d'être déployée. Une liste tenue à la main
serait périmée la semaine suivante et ne contiendrait jamais toutes les sangles
du monde. Ce qui est saisi est ce que le registre connaît, et le contrôle des
rappels lit la marque et le modèle directement dedans.

Ce qui a été cherché, et ce que ça vaut :

| Source | Ce que c'est | Verdict |
|---|---|---|
| [UIAA Certified Equipment](https://www.theuiaa.org/safety/certified-equipment/) | Le registre du label de sécurité UIAA : 2 000+ labels, 70+ fabricants | **Le meilleur candidat**, avec des réserves (ci-dessous) |
| [Open Products Facts](https://world.openproductsfacts.org) | Base ouverte par code-barres, sœur d'Open Food Facts | Vide en pratique : 5 produits Petzl, tous des frontales ; rien au code-barres de la corde rappelée |
| Icecat | Données produit ouvertes pour l'e-commerce | Non vérifié — inscription requise, présence du matériel d'escalade inconnue |
| Registres EPI commerciaux (Papertrail…) | Bibliothèques produit propriétaires | Fermés |

**Sur l'UIAA, précisément** (testé le 21 août 2026) :

- Le formulaire poste sur la page elle-même et renvoie un `<table
  class="api-results-table">` : pas d'API JSON, mais parfaitement lisible.
- Champs du formulaire : `product_name`, `product_number`, `equipment`,
  `brand_name`, `certificate_number`, `extend_search`.
- **L'extraction en masse marche par catégorie** : un POST avec
  `equipment=UIAA 105 Harnesses` a renvoyé **321 harnais** d'un coup, et la
  liste déroulante compte **166 catégories**. Le tout est donc atteignable en
  ~166 requêtes.
- Colonnes : norme, référence produit (`C051yBxx`), nom, taille, n° de
  certificat (`FRA 23-6756`), statut (`Active`).

Trois réserves, et elles comptent :

1. **La colonne « Brand Name » revient vide** sur toutes les lignes testées
   (CORAX, KLIMB, AGNER W), et `brand_name=Petzl` ne renvoie qu'une ligne. On
   obtient donc des *noms de produits sans fabricant* — gênant pour un registre
   qui rapproche marque + modèle. Le lien « Details » pointe vers
   `certificate.php?IDLabel=…`, qui répond 404 de l'extérieur.
2. **Le label est volontaire** : la couverture est partielle par construction.
   `brand_name=Simond` renvoie 0. Beaucoup de matériel parfaitement certifié CE
   n'y figure pas.
3. **Ni API ni licence affichée.** Le `robots.txt` n'interdit pas la page, mais
   aspirer le registre de sécurité de quelqu'un d'autre relève de sa décision,
   pas de la nôtre.

**Prochaine étape si le sujet revient** : écrire à `safetylabel@theuiaa.org`
pour demander un export ou l'autorisation, avec les marques attachées. Si c'est
oui, un import périodique dans une table `gear_models` et l'autocomplétion
revient, cette fois sur des données certifiées. Si c'est non, le texte libre
est la bonne réponse et rien n'est perdu.

## 5. Non implémenté — les pistes qui valent le coup

Par ordre d'intérêt, à mon sens :

1. **Lier le matériel aux sorties.** C'est la seule chose qu'aucun autre outil
   EPI ne peut offrir : le matériel vit déjà à côté d'un carnet. « Cette corde a
   47 journées, dont 31 sur du calcaire » réforme sur l'usage plutôt que sur le
   calendrier — et surtout, **l'historique des chutes** : consigner une chute
   sévère sur une corde précise, le jour où elle a eu lieu, est le motif de
   réforme anticipée qu'on oublie six mois plus tard.
2. **Photo de l'objet et de l'étiquette.** Le stockage photo existe déjà.
   L'étiquette est la preuve derrière les dates.
3. **Rappels d'échéance par email.** La machinerie existe
   (`lib/email-notifications.ts`) et le regroupement mensuel est de toute façon
   à faire — « 3 EPI à contrôler ce mois-ci » est exactement ce qui doit partir
   groupé plutôt qu'un email par objet.
4. **Export PDF.** `pdf-lib` est déjà là et sert au carnet
   (`api/carnet/route.ts`). Un registre doit pouvoir se présenter et s'imprimer.
5. **Lots / kits.** Un club raisonne en « matériel via ferrata jeunes », pas en
   objets.
6. **Partage** : un club, ou un guide qui fait le contrôle annuel. Le modèle de
   la wishlist partagée (`wishlist_members`) a la bonne forme. C'est une
   décision de produit — aujourd'hui personne d'autre ne peut lire un registre.
7. **Scan de l'étiquette** (QR / datamatrix, que la plupart des EPI récents
   portent) pour saisir le n° de série sans le taper.

## 6. Ce qui a été vérifié

Contre une base construite depuis `schema.sql`, en pilotant un vrai navigateur :

- ajout, contrôle, réforme, historique ;
- une corde fabriquée il y a douze ans s'affiche « au-delà de la limite » ;
- un contrôle « à surveiller » fait basculer l'état et apparaît dans
  l'historique ;
- la réforme laisse l'objet visible et marqué ;
- 404 pour quelqu'un d'autre ;
- le rappel apparaît sur une Beal Sunrise 9.2, reste muet sur une Booster III ;
- « Béal », « BEAL » et « beal » retrouvent le même rappel.

`scripts/check-schema.mjs` couvre l'accord entre `schema.sql` et les
migrations ; il n'y a pas encore de test automatisé du registre lui-même.
