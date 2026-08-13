# Cragidary — sujets laissés ouverts

État au 13 août 2026. L'essentiel de ce qui suit n'est **pas** implémenté : ce
sont les décisions prises ou les pistes évaluées pendant l'ajout d'OpenBeta,
notées pour ne pas refaire deux fois la même enquête. Ce qui est en production
est décrit par le code et l'historique git, pas ici — sauf exception signalée
explicitement (§6, §6bis) quand une fonctionnalité est en prod mais qu'un
sujet à côté reste ouvert.

## 1. Crédit des photos importées de camptocamp — décidé, non implémenté

**Le problème.** L'import télécharge les photos et les ré-héberge
(`EntryForm.tsx`, appel à `/api/c2c/image`), en ne retenant que le nom de
fichier (`lib/c2c.ts`, construction de `images`). Ni l'auteur ni la licence ne
sont conservés.

**Ce que dit camptocamp** (article 106728, « Licences des contenus ») :

| `image_type` | Licence | Ce qu'elle permet |
|---|---|---|
| `collaborative` | CC BY-SA | copie **et** modification |
| `personal` | CC BY-NC-ND | « seule la copie est donc autorisée », pas d'usage commercial |

L'attribution exigée est un triptyque : **le nom du contributeur**, **le lien
vers le document**, **la mention de la licence**. Les huit images échantillonnées
étaient toutes `personal`.

Deux frictions avec le code actuel : les photos sont **recompressées** dans le
navigateur avant l'upload (donc *modifiées*, ce que ND interdit), et le NC
deviendrait gênant le jour où une offre payante existe.

**Mais l'auteur n'est pas lié par sa propre licence.** Une licence CC est une
concession de l'auteur vers les tiers. Pour ses propres photos, l'utilisateur ne
doit rien à personne — et c'est le cas dominant, puisque la synchro importe son
carnet. La vraie question n'est donc pas « quelle licence » mais « à qui est
cette photo ».

**Décision retenue :**

- une requête par photo à l'import, pour lire `creator.user_id`, `creator.name`,
  `author` et `image_type` sur le document image (l'association d'une sortie ne
  donne que le nom de fichier) ;
- si `creator.user_id` == `users.c2c_profile_id` → rien ne change : copie,
  recompression, aucun crédit ;
- sinon → crédit, et pas de recompression pour une image `personal` ;
- si `author` est renseigné, il l'emporte sur le test des identifiants : c'est la
  photo déposée par l'un et prise par l'autre ;
- profil sans compte c2c lié → on ne peut pas savoir, on crédite par défaut.
  Inoffensif : un crédit sur sa propre photo est du bruit, pas une faute. La page
  d'import connaît déjà `linkedProfileId` et peut inciter à lier le compte.

**Forme du crédit :** un bloc unique **sous la galerie**, calculé à partir des
données — « Photos : Damelko, Pierre Untel — camptocamp.org, CC BY-NC-ND », chaque
nom lié à son image. Deux colonnes à ajouter sur `photos` (nom du créateur, id de
l'image c2c), dans l'esprit du `c2c_filename` existant.

Écarté en chemin, et pourquoi :

- **une case « je certifie être propriétaire »** : sur une sortie à plusieurs, une
  partie des photos vient des copains ; la personne cocherait de bonne foi et
  aurait tort pour la moitié du lot. Et une case ne produit pas l'attribution que
  la licence réclame, elle déplace seulement la responsabilité ;
- **ajouter les crédits à la fin de `notes`** : c'est le texte de la personne, il
  sera édité et la ligne sautera ; et une seconde synchro les recollerait, faute
  d'un garde-fou équivalent à `c2c_filename` pour du texte.

> Lecture du texte de camptocamp, pas un avis juridique. Le principe « l'auteur
> n'est pas lié par sa propre licence » est en revanche du droit d'auteur général.

## 2. OpenStreetMap comme couche parking / approche — la piste la plus rentable

OpenBeta ne donne **aucun point d'accès**, là où camptocamp fournit le parking via
ses waypoints `access`. C'est le trou le plus visible des résultats américains.

OSM connaît `amenity=parking`, les sentiers d'approche, l'eau, les restrictions
d'accès. **Ce n'est pas une base de voies** : mesuré sur Overpass, 244 objets
d'escalade autour de Chamonix (contre ~822 voies c2c) et 71 autour de Boulder
(contre 764 falaises OpenBeta), dont **1 seule** portait une cotation. À utiliser
en enrichissement, jamais comme source de résultats.

Coût : Overpass est une API publique partagée qui m'a throttlé plusieurs fois
pendant les sondages — il faudrait du cache sérieux. Licence ODbL, partage à
l'identique.

## 3. OSM pour les via ferrata et le ski de rando — tiède

132 chemins autour de Chamonix (85 `piste:type=skitour`, 47
`highway=via_ferrata`), dont 71 avec une difficulté — bien meilleur ratio que
l'escalade, et `via_ferrata_scale` (échelle K allemande, chiffre nu) tomberait
pile sur le `krat` déjà utilisé côté c2c.

Le piège : **ce sont des segments, pas des itinéraires**. « Via Ferrata Roc du
Vent » apparaît trois fois, découpée aux changements de cotation. Il faudrait
regrouper par nom et fusionner les géométries. Et c2c couvre déjà bien les Alpes
sur ces deux activités.

## 4. theCrag — bloqué sur une démarche humaine

La seule base qui étendrait vraiment la couverture rocher hors de France
(Espagne, Italie, Australie, Asie). L'API existe mais renvoie **403** sans
identifiants : elle est derrière une clé de partenariat. Demande à faire par mail
à leur équipe — rien à coder tant que ce n'est pas obtenu.

## 5. skitour.fr — possible, gain modeste

Vraie API JSON, mais `{"ERROR": "NO API KEY"}` : clé à récupérer via un compte.
Recouvre largement camptocamp sur le ski de rando, donc peu de gain pour le coût.

## 6. Météo — fait, en version minimale (13 août 2026)

Un lien « ouvrir dans… » par résultat, au même point que le parking
(`WeatherLink.tsx`) : Windy et Meteoblue, sur les coordonnées exactes du
résultat. Pas d'appel serveur, pas de clé, pas de CGU à vérifier — le site ne
fait qu'ouvrir un lien externe.

Ce que ça ne couvre pas, et qui reste ouvert si le besoin revient : la météo
*sur une entrée passée* (dater une sortie du carnet) ou un filtre « beau temps
ce week-end » dans Cragseeker lui-même, qui demanderaient un vrai appel API
côté serveur. **Open-Meteo** reste le candidat évident pour ça — répond en 200
sans clé, `weather_code`/`temperature_2m_max`/`precipitation_sum` par jour,
fuseau automatique — à vérifier alors : ses CGU pour un site public, et
l'existence d'un historique pour dater des entrées passées.

À noter, piège maison : `next.config.ts` interdit la géolocalisation à l'échelle
du site (voir la mémoire *Permissions-Policy*), ce qui a déjà mordu.

## 6bis. Salles d'escalade — fait, mais invisibles en prod (13 août 2026)

Couche carte, même traitement que les refuges (`lib/seeker/gyms.ts`,
`/api/seeker/gyms`) : OpenStreetMap via Overpass, `sport=climbing` +
`leisure` dans `sports_centre`/`climbing` — filtre qui exclut les falaises
mappées en point. Vérifié en direct : Chamonix, Paris et Berlin ont de vraies
salles dans OSM (jusqu'à 31 résultats), la requête et le parsing sont
corrects.

**Le problème n'est pas le code, c'est le réseau.** Vu en production
(`cragdiary.com`, logs Vercel) : les quatre miroirs Overpass testés
(`overpass-api.de`, `overpass.kumi.systems`, `overpass.osm.ch`,
`overpass.private.coffee`) répondent tous instantanément depuis n'importe quel
autre réseau, mais **restent muets jusqu'au timeout** depuis Vercel — pas un
refus rapide, un silence. Quatre opérateurs indépendants avec le même
comportement, ça ressemble à un blocage par plage IP/ASN (AWS Lambda, qui
héberge les fonctions Vercel), une pratique courante contre le scraping côté
opérateurs Overpass auto-hébergés — pas à une coïncidence de charge.

Le code dégrade proprement (`ok: false`, pas de cache sur un échec, voir
`src/lib/seeker/gyms.ts`) : la couche affiche juste « rien » plutôt que de
planter ou de mentir pendant 24 h. Mais elle n'affichera vraisemblablement
jamais rien tant que ceci n'est pas résolu.

Quatre pistes identifiées, aucune tentée :

- **Un relais Cloudflare Worker** devant Overpass : IP différentes de celles
  d'AWS, gratuit, garde les données OSM déjà vérifiées bonnes. Coût : une
  deuxième infra à maintenir hors Vercel.
- **Google Places API** (`climbing_gym`) : source consolidée, fiable, pas de
  pari réseau — mais payante (crédit mensuel gratuit probablement suffisant à
  ce trafic) et clé à gérer. Première dépendance payante du projet si retenue.
- **Geoapify Places API**, vérifié le 13 août : mêmes données OSM, mais
  servies par leur propre infra plutôt que par les miroirs Overpass bloqués —
  contourne vraisemblablement le blocage sans repayer ni maintenir un relais.
  Gratuit, 3000 requêtes/jour, **aucune carte bancaire requise**. Catégorie
  `entertainment.activity_park.climbing`, dérivée des mêmes tags OSM
  (`sport=climbing`) que la requête Overpass actuelle. Demande tout de même
  une clé API — première dépendance à clé du projet pour une recherche, alors
  que c2c, OpenBeta, refuges.info et Overpass sont tous sans clé.
- **LocationIQ** (vérifié le 13 août, même famille que Geoapify) : gratuit,
  5000 requêtes/jour, sans carte, données OSM, attribution requise sur le
  plan gratuit. Pas creusé plus loin, Geoapify déjà suffisant comme piste.

Décidé le 13 août : **on s'arrête là pour l'instant**, y compris l'offre de
basculer sur Geoapify (déclinée) — le reste de la session (météo, bascule des
deux bases, message d'erreur de géolocalisation, cache des photos privées)
est en production et solide.

## 7. Décidés et clos — ne pas rouvrir

- **Mountain Project** : API publique fermée depuis fin 2020, onX refuse les
  nouvelles demandes (écrit sur leur page `/data`), `robots.txt` interdit
  `/data*`. Le scraping serait contre leurs CGU. Fermé.
- **Filtre par cotation sur OpenBeta** : volontairement absent. Une falaise
  porte une *étendue* de cotations ; filtrer dessus écarterait une falaise avec
  un 5.13 au milieu de voies faciles. L'étendue est affichée, l'œil filtre.
- **27crags, UKClimbing, gulliver.it** : pas d'API publique (404).

## 8. Petites dettes connues

- **Pagination multi-sources** : chaque source est paginée au même `offset`, donc
  une « page » grossit avec le nombre de bases cochées (jusqu'à 60 résultats à
  deux sources) et la page 2 recommence l'échelle des distances. Cohérent avec ce
  que faisait c2c seul, mais ce n'est pas une vraie fusion paginée.
- **Rayon OpenBeta plafonné à 100 km** (`MAX_RADIUS_KM` dans `lib/seeker/openbeta.ts`)
  alors que c2c va à 300 : au-delà, `cragsNear` devient lent (~1400 falaises et
  ~6 s pour 100 km autour de Yosemite).
- **refuges.info** : l'API plafonne à 250 points sauf `nb_points` explicite (on
  demande 400). Une très grande boîte serait donc tronquée en silence.
