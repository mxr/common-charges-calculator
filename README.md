# Common Charges Calculator

Frontend-only tool for splitting a building's annual expenses into per-unit and per-owner common charges. Works for condos, co-ops, TICs, and similar associations. Define owners, units (with type and common interest), expenses, and the policies that decide how each expense is split. The calculator shows annual and monthly charges instantly.

## Features
- Owners, units, unit types, and expense categories you can edit
- Flexible split policies: by common interest, equal per unit, or equal per owner, with multi-rule splits (e.g. 5% commercial / 95% everyone else)
- Excluded units (board / sponsor / association owned) pay nothing; their share is absorbed by the rest
- Global adjustments: inflation % on the expense base and a reserve % for savings
- URL persistence (compressed) so you can bookmark or share a budget
- JSON export/import
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
- All calculations run locally in the browser. Data never leaves your machine.
- State is stored in the URL, so saving the page or sharing the link preserves the budget.
