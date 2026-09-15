# Publier une sortie sur camptocamp depuis Cragdiary — étude

État au 14 septembre 2026. **Rien de ce qui suit n'est implémenté.** C'est
l'enquête faite avant de décider, pour ne pas la refaire : ce que l'API permet
vraiment, ce qui bloque, et le flux que je recommande si on y va.

L'import existe déjà et ne lit que l'API publique (`src/lib/c2c.ts`). Publier,
c'est l'autre sens, et c'est une autre affaire : il faut être identifié *en tant
que le membre*, et ce qui part ne revient pas.

---

## 1. Ce que l'API permet — vérifié

Tout ce qui suit vient du code de `c2corg/v6_api` (branche master, lue le
14/09/2026) et de requêtes réelles contre `api.camptocamp.org`.

**S'identifier.** `POST /users/login`, corps
`{"username": "...", "password": "...", "discourse": false}`. Réponse :
`{token, expire, roles, ...}`. Le jeton se présente ensuite en en-tête
`Authorization: JWT token="<token>"`.

* Validité : **14 jours** (`CONST_EXPIRE_AFTER_DAYS` dans `security/roles.py`).
* `POST /users/renew` (authentifié) rend un jeton neuf pour 14 jours — donc un
  jeton entretenu ne meurt jamais, et un jeton oublié meurt tout seul.
* Si le membre n'a jamais accepté les CGU, l'API répond **403** tant que la
  requête ne porte pas `accept_tos: true`. Accepter les CGU de quelqu'un d'autre
  depuis notre serveur, c'est non : dans ce cas on renvoie l'utilisateur sur
  camptocamp.

**Créer une sortie.** `POST /outings`, vue `restricted_json_view` — jeton
obligatoire. Les validateurs (`views/outing.py`) exigent :

| Contrainte | Détail |
|---|---|
| `associations.routes` | **au moins un itinéraire** (`validate_required_associations`) |
| `associations.users` | **au moins un membre** — l'auteur |
| `activities` | non nul, parmi la liste fermée (§4) |
| `date_start`, `date_end` | `YYYY-MM-DD`, ni l'une ni l'autre à plus de 12 h dans le futur, fin ≥ début |
| géométrie | facultative : à défaut, l'API la déduit des itinéraires liés |

**Modifier.** `PUT /outings/{id}` — seulement si le membre est associé à la
sortie (`has_permission_for_outing`), sinon 403.

**Supprimer.** `DELETE /documents/delete/{id}` — et là il faut lire la règle en
entier (`views/document_delete.py`, `validate_requestor`) :

> l'auteur initial peut supprimer sa sortie **pendant 24 h**. Passé ce délai,
> seuls les modérateurs le peuvent.

C'est le fait le plus structurant de toute cette étude. Une publication ratée
n'est pas rattrapable par nous : elle devient du bruit dans le topoguide de tout
le monde, et il faut aller déranger un modérateur.

---

## 2. Les trois obstacles réels

### 2.1 L'identification : pas d'OAuth, et le navigateur est fermé

Camptocamp n'a pas de « connexion via c2c » pour les sites tiers. Il n'y a que
l'identifiant et le mot de passe du membre. Trois façons de faire, par ordre de
ce que ça nous fait détenir :

1. **Le mot de passe, jamais stocké.** On le demande au moment de publier, on
   l'échange contre un jeton, on publie, on jette les deux. Coût : retaper son
   mot de passe à chaque sortie publiée.
2. **Le jeton, chiffré, renouvelé.** Une seule saisie du mot de passe, puis on
   garde le jeton (14 jours, renouvelable indéfiniment). C'est confortable, et
   c'est un jeton qui peut **modifier et supprimer tout ce que le membre a écrit
   sur camptocamp** : une fuite de notre base devient une fuite chez eux. Si on
   le fait, il faut un chiffrement à clé hors base et un bouton « oublier mon
   compte c2c » qui appelle `POST /users/logout`.
3. **Depuis le navigateur, sans passer par nous.** Ce serait le mieux — les
   identifiants ne toucheraient jamais notre serveur. **C'est fermé** : l'API
   n'autorise le CORS que pour une liste d'origines tenue par l'association.
   Vérifié :

   ```
   $ curl -X OPTIONS https://api.camptocamp.org/users/login \
       -H 'Origin: https://cragdiary.com' -H 'Access-Control-Request-Method: POST'
   400 {"errors":[{"location":"header","name":"Origin",
        "description":"https://cragdiary.com not allowed"}]}
   ```

   Le réglage est `cors.allowed_origins` côté serveur, et le code refuse
   explicitement `*` (« a wildcard would allow any website to make cross-origin
   requests to this API on behalf of a logged-in user »). Ça se demande à
   l'association ; ça ne se contourne pas.

**Recommandation : (1) d'abord.** Le mot de passe ne traverse que la requête,
en mémoire, et rien n'est gardé. Si l'usage prouve que c'est pénible, (2)
devient un choix explicite de l'utilisateur, pas le défaut.

### 2.2 Une sortie sans itinéraire c2c est impossible à publier

`associations.routes` est obligatoire. Or une journée Cragdiary n'a pas
forcément de `c2c_url` : elle peut être tapée à la main, ou venir d'OpenBeta.
Dans ce cas, publier suppose de **choisir un itinéraire camptocamp** — ce que
l'éditeur sait déjà faire (`searchRoutes` dans `lib/c2c.ts`, le champ voie).

Conséquence sur l'interface : le bouton « publier sur camptocamp » ne peut pas
être offert partout. Il est offert quand la journée porte un itinéraire c2c, et
sinon il commence par demander lequel.

Créer l'itinéraire manquant sur camptocamp depuis chez nous : **non**. Les
itinéraires sont du topoguide collaboratif, `validate_requestor` interdit
d'ailleurs à un non-modérateur de supprimer un `route`. On ne fabrique pas du
topoguide par effet de bord.

### 2.3 L'irréversibilité, donc pas d'automatisme

Vu la règle des 24 h, « publier automatiquement chaque journée publique » est à
écarter. Ce qui reste :

* un bouton **par sortie**, jamais une synchronisation de fond ;
* un **aperçu de ce qui va partir**, champ par champ, avant l'envoi ;
* après coup, le lien vers la sortie créée, et pendant 24 h un bouton
  « retirer de camptocamp » qui appelle vraiment `DELETE` ;
* l'id c2c de la sortie créée stocké chez nous (`entries.c2c_outing_id`), pour
  ne jamais republier deux fois la même journée — et pour que l'import
  (`listUserOutings`) ne réimporte pas ce que nous avons nous-mêmes écrit.

---

## 3. Les photos

Deux étapes, et la première est publique :

1. `POST https://images.camptocamp.org/upload`, multipart, champ `file` →
   le service répond en JSON avec le nom de fichier. Vérifié : l'endpoint
   existe, ne demande **pas** de jeton (`access-control-allow-origin: *`), et
   refuse ce qui n'est pas une image (`{"error": "Unknown image format"}`).
2. `POST /images/list` (authentifié) avec la liste des documents image —
   `filename`, `image_type`, `locales`, et les associations vers la sortie.
   L'API demande alors au backend de *publier* le fichier déposé.

Deux choses à trancher avant d'écrire une ligne :

* **`image_type`.** `collaborative` (CC BY-SA) ou `personal` (CC BY-NC-ND) : ce
  n'est pas à nous de choisir à la place de l'auteur, il faut le demander.
* **Les photos qui ne sont pas de lui.** Une journée Cragdiary peut afficher les
  photos d'un compagnon de cordée (jour lié, `getSharedDay`) et des photos
  importées de camptocamp. Ni les unes ni les autres ne partent : on ne publie
  que les photos téléversées par l'auteur lui-même sur sa propre journée. Voir
  `docs/cragseeker-wip.md` §1, même problème d'attribution vu de l'autre côté.

---

## 4. Correspondance des champs

Les journées importées de c2c portent déjà le vocabulaire de c2c — l'import lit
`rock_free_rating`, `global_rating`, `orientations`, `equipment_rating`. Dans ce
sens-là, la traduction est presque l'identité ; le travail est de **valider**,
parce qu'une journée tapée à la main peut contenir n'importe quoi.

| Cragdiary (`entries`) | camptocamp (outing) | Remarque |
|---|---|---|
| `entry_date` | `date_start` = `date_end` | `month_only` : impubliable en l'état (il faut un jour) |
| `crag`, `location` | — | ils viennent de l'itinéraire lié, pas de la sortie |
| `notes` | `locales[].description` | markdown ; nos mentions `@pseudo` ne veulent rien dire là-bas |
| `partners` | `locales[].participants` | texte libre, plus `associations.users` pour ceux qui ont un compte c2c connu |
| `grade_max` | `rock_free_rating` | liste fermée (`2`, `3a`…`9c`) — à valider, sinon on omet |
| `rating` | `global_rating` | `F`…`ED+`, idem |
| `equipment` | `equipment_rating` | `P1`…`P4+` |
| `orientation` | — | la sortie n'en a pas ; c'est un champ d'itinéraire |
| `height_m` | `height_diff_up` ou `elevation_max` | à trancher : ce ne sont pas la même chose |
| `style` | `activities[]` | un seul vrai candidat ici : `rock_climbing` ; les autres valeurs de la liste (`mountain_climbing`, `ice_climbing`, `via_ferrata`, `hiking`…) demandent une correspondance explicite |
| `c2c_url` | `associations.routes[0]` | l'id s'en extrait déjà (`parseOutingId` fait le même travail pour les sorties) |

Un champ omis vaut mieux qu'un champ inventé : le topoguide se lit, et une
cotation fausse n'est pas une donnée manquante, c'est une donnée fausse.

---

## 5. Ce que je recommande

Un chemin, explicite, par journée :

1. Sur une journée à soi, publique, avec un itinéraire c2c : un bouton
   « publier sur camptocamp ».
2. Il ouvre un aperçu : les champs qui partiront, les photos cochées, le choix
   de licence, et le mot de passe c2c demandé là, pour cette fois.
3. Le serveur se connecte, publie, associe les photos, et écrit l'id rendu dans
   `entries.c2c_outing_id`.
4. La journée affiche ensuite « publiée sur camptocamp » avec le lien, et
   pendant 24 h la possibilité de la retirer.

Ce qui reste hors périmètre, et devrait le rester : la publication automatique,
la mise à jour continue d'une sortie déjà publiée (`PUT` marche, mais deux
récits qui divergent valent mieux qu'un récit écrasé sans qu'on le voie), et la
création d'itinéraires.

## 6. Ce qui reste à vérifier avant d'écrire du code

* **Essayer pour de vrai sans salir le topoguide.** `api.demov6.camptocamp.org`
  ne répond pas depuis ici (temps mort). Reste à monter `v6_api` en local
  (docker, dépôt `c2corg/v6_api`) — c'est le seul moyen honnête de tester un
  `POST /outings` sans laisser une sortie de test que l'on ne pourra plus
  supprimer passé 24 h.
* **La charte du contributeur** (article 106730) : lire ce qu'elle dit d'un
  récit publié depuis un outil tiers, et si l'usage veut qu'on le signale dans
  le texte de la sortie.
* **Le rythme toléré.** Rien dans le code lu ne limite les écritures ; ça ne
  veut pas dire qu'en publier cinquante d'affilée est bien vu. Si un jour on
  offre « publier les anciennes », le demander d'abord sur le forum.
* **Les CGU** (article 106731) interdisent l'extraction d'une part substantielle
  de la base à des fins commerciales et le scraping non autorisé. Publier *ses
  propres* sorties avec *son propre* compte n'entre pas là-dedans, mais c'est à
  garder en tête si l'outil venait à écrire à grande échelle.

---

## 7. Ce qui a été construit — POC, compte admin seulement (15 septembre 2026)

Une première mise à l'épreuve, derrière `ADMIN_USERNAME`, dans la page de
modification d'une journée à soi. Ce n'est pas la fonctionnalité : c'est de quoi
savoir si elle tient debout.

| | |
|---|---|
| Où | `src/lib/c2c-publish.ts`, `src/components/C2cPublishPoc.tsx`, actions dans `src/app/actions.ts` |
| Migration | **042** — `entries.c2c_outing_id`, la sortie *créée* (à ne pas confondre avec `c2c_url`, la sortie *importée*) |
| Test | `scripts/c2c-publish-check.mjs` (serveur lancé avec `ADMIN_USERNAME=bossman`) |

Ce qu'il fait : aperçu du document exact avant tout envoi, publication à la
demande d'**une** journée, et un bouton « retirer » qui marche tant que la
fenêtre de 24 h est ouverte. Le mot de passe sert une fois, en mémoire ; on
déconnecte le jeton derrière. Un champ qui ne tombe pas dans le vocabulaire c2c
est omis et signalé dans l'aperçu, jamais approximé.

Ce qu'il ne fait pas : les photos (§3), les journées sans itinéraire c2c (§2.2),
les journées au mois près, et celles déjà importées de camptocamp.

**Le `POST /outings` n'a jamais été exécuté pour de vrai.** Le test ne parle
pas à camptocamp, exprès : une sortie de test ne serait plus supprimable le
lendemain. Le premier vrai essai doit donc être une vraie journée qu'on voulait
publier — et le bouton « retirer » est là pour les 24 h qui suivent. Vérifié en
revanche que la requête de connexion est bien formée : `POST /users/login` avec
un compte inexistant répond `401 Login failed`, pas une erreur de schéma.
