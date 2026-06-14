# Publier une release de gitui

Les installateurs sont construits par `.github/workflows/release.yml` (déclenché par un tag
`v*`). L'updater intégré + la fenêtre « Quoi de neuf » font le reste côté utilisateurs.

## Les 3 étapes

### 1. Taguer la version et pousser le tag
La version est **dérivée du tag** — pas besoin de modifier les fichiers de version à la main.

```bash
git checkout master && git pull
git tag v0.2.7
git push origin v0.2.7
```

Le CI compile tous les installateurs (Windows / macOS / Linux AppImage·deb·rpm / Arch
`.pkg.tar.zst`), **signe** les artefacts updater, génère `latest.json`, et crée une release
en **draft**.

### 2. Écrire les notes de version (≈ 12 min plus tard, quand le run est vert)
Ces notes s'affichent **telles quelles** dans la popup « Quoi de neuf » de l'app : écris-les
en **langage clair et orienté utilisateur** (pas de jargon, pas de références aux PRs/commits).

```bash
gh release edit v0.2.7 --notes "## ✨ Nouveautés
- L'application se met à jour toute seule, en un clic
- Une fenêtre « Quoi de neuf » s'affiche après chaque mise à jour"
```

*(Ou : sur la page GitHub de la release draft → « Edit » → tape les notes dans la description.)*
Si tu n'écris rien, le corps reste vide et **aucune popup** ne s'affiche (pas de texte générique).

### 3. Publier le draft
```bash
gh release edit v0.2.7 --draft=false
```
Si ça répond `release not found`, le draft n'est pas encore créé (attends le CI). Solution de
repli (publier par ID, sans le lookup par tag) :
```bash
gh api -X PATCH "repos/Corentin-vidonne/gitui/releases/$(gh api repos/Corentin-vidonne/gitui/releases --jq '.[]|select(.tag_name=="v0.2.7").id')" -F draft=false
```

## Ce que voient les utilisateurs

| Install | Mise à jour |
| --- | --- |
| Windows `.msi`/`.exe`, macOS `.dmg`, Linux **AppImage** | bannière → **bouton un-clic** (download + install + relaunch) |
| Linux `.deb` / `.rpm` / Arch `.pkg.tar.zst` (pacman) | bannière → **« Télécharger »** + maj via le gestionnaire de paquets |

Après la mise à jour, au redémarrage, la popup **« Quoi de neuf »** affiche les notes que tu as
écrites pour cette version.

## À savoir / pièges

- **La version vient du tag.** `tauri.conf.json` / `Cargo.toml` / `package.json` sont renseignés
  depuis le tag au build (`.github/scripts/stamp-version.mjs`) — ne les bumpe pas à la main.
- **La notif est basée sur le numéro de version**, pas sur le code : un tag plus élevé → les
  utilisateurs sont notifiés (même sans changement de code) ; réutiliser un tag → rien.
- **Bootstrap :** l'updater ne marche que dans les builds qui le contiennent déjà. Les utilisateurs
  existants doivent installer **une fois à la main** une release qui a l'updater ; ensuite c'est
  automatique. Il faut **2 releases** pour voir une notif (installer vN, publier vN+1).
- **Les secrets de signature doivent rester en place** : `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (repo → Settings → Secrets → Actions). La clé publique est
  dans `tauri.conf.json`. Sans eux, le build ne produit pas `latest.json`. **Ne jamais committer la
  clé privée** (`*.key` est gitignoré).
- **`default_workflow_permissions` doit être `write`** (repo → Settings → Actions → Workflow
  permissions), sinon le CI ne peut pas créer la release (403).
- **« Éditeur inconnu » / « source inconnue »** (Windows SmartScreen / macOS Gatekeeper) est un
  sujet séparé : il faut un **certificat de code-signing OS payant** (Apple ~99 $/an, Windows
  Authenticode). Linux n'affiche aucun avertissement.
