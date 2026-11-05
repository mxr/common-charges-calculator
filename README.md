# Common Charges Calculator

Tool for splitting a building's annual expenses into per-unit and per-owner common charges. Works for condos, co-ops,
TICs, and similar associations. Define owners, units (with type and common interest), expenses, and the policies that
decide how each expense is split. The calculator shows annual and monthly charges instantly.

## Features

- Owners, units, unit types, and expense categories you can edit
- Flexible split policies: by common interest, equal per unit, or equal per owner, with multi-rule splits (e.g. 5%
  commercial / 95% everyone else)
- Board-owned units pay nothing; their share of each expense is spread across all other units by common interest
- Global adjustments: inflation % on the expense base and a reserve % for savings
- URL persistence (compressed) so you can bookmark or share a budget
- JSON export/import
- Optional accounts: log in with an emailed code to save budgets as drafts under buildings and projects
- Unit tests + coverage

## Getting started

```sh
npm install
npm run dev
```

## Tests

```sh
npm run test
npm run test:coverage
```

## Build

```sh
npm run build
```

## Notes

- Without an account, all calculations run in the browser and the budget is stored in the URL, so saving the page or
  sharing the link preserves the budget. Loading the page sends that URL to Vercel.
- A budget saved to an account is stored in the app's Neon Postgres database. Anyone with access to the Neon project can
  read every saved budget.
