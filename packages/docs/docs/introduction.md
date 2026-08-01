---
sidebar_position: 1
slug: /
---

# WaslPay SDK

WaslPay est un SDK unifié permettant d'intégrer les paiements mobile money en Afrique de l'Ouest (Orange Money, Wave et MTN MoMo) à travers une API standardisée pour **Node.js**, **PHP** et **Python**.

## Le problème résolu : la fragmentation du Mobile Money

En Afrique de l'Ouest, le paiement numérique est dominé par le Mobile Money, mais le marché est fortement fragmenté entre plusieurs opérateurs régionaux. Chaque fournisseur (Orange Money, Wave, MTN MoMo) expose sa propre API REST, son propre format de requêtes, sa propre méthode de signature HMAC pour les webhooks, ainsi que des structures d'erreurs et des cycles de vie de session spécifiques.

Pour un marchand ou une équipe de développement, accepter plusieurs moyens de paiement implique habituellement :
- D'écrire et maintenir autant d'adaptateurs sur mesure qu'il y a d'opérateurs.
- Ou de s'en remettre à des agrégateurs commerciaux tiers imposant des frais d'intermédiaire et une dépendance technique.

**WaslPay résout cette fragmentation** en agissant comme une couche d'abstraction unique et agnostique. Chaque fournisseur est encapsulé dans un adaptateur strict qui implémente le contrat universel `PaymentProvider`. Vos applications dialoguent avec la façade `WaslPay` et manipulent des objets normalisés quel que soit l'opérateur sous-jacent.

## Providers et langages supportés

### 3 Providers intégrés
- **Orange Money** : Paiements Mobile Money via l'API Web Payment.
- **Wave** : Paiements et remboursements via l'API Wave Checkout.
- **MTN MoMo** : Collection de paiements et remboursements via l'API Collection.

*(Remarque : Free Money et Wizall ne disposant pas d'API directes sans passer par un agrégateur tiers, ils sont délibérément exclus du périmètre de WaslPay afin de préserver l'indépendance vis-à-vis d'intermédiaires).*

Consultez le document [Compatibilité et capacités par provider](compatibility.md) pour découvrir le détail des fonctionnalités prises en charge par chaque opérateur (gestion du statut `expired`, remboursements totaux/partiels, etc.).

### 3 Runtimes et SDKs officiels
- **Node.js / TypeScript** (`@waslpay/core-node`)
- **PHP** (`waslpay/core-php`)
- **Python** (`waslpay-sdk`)

Toutes les implémentations garantissent le même contrat d'interface, la même validation stricte des statuts (`PaymentStatusResult`), et la même déduplication d'événements via `WebhookEventStore`.

## Explorer la documentation

Voici comment est structuré ce portail de documentation :

- **[Démarrer](getting-started/quickstart.md)** : Installez le SDK et exécutez un premier flux complet (création de session, contrôle de statut, validation de webhook et remboursement) en moins de 5 minutes contre notre serveur mock local.
- **[Guides](guides/webhooks.md)** : Apprenez à sécuriser la réception des webhooks (vérification de signature HMAC, déduplication et idempotence) et à gérer les demandes de remboursement.
- **[Providers](providers/capabilities.md)** : Examinez la matrice comparative des capacités de chaque opérateur pour adapter le parcours utilisateur de votre application.
- **[Référence](reference/contract.md)** : Consultez les spécifications détaillées de l'interface `PaymentProvider`, de l'union discriminée `PaymentStatusResult` et de l'énumération d'erreurs `PaymentError`.
- **[CLI](cli.md)** : Découvrez l'outil en ligne de commande `@waslpay/cli` pour échafauder vos projets et lancer le serveur de mock local sans clé API de production.
