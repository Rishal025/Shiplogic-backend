# Document Extraction API — Expected Response Schema (for Python team)

**Endpoint:** `POST /api/v1/shipment/extract-documents`  
**Request:** `multipart/form-data` with two files:
- `document1` — e.g. Proforma Invoice (PI)
- `document2` — e.g. Purchase Order (PO)

**Response:** `200 OK` with JSON body:

```json
{
  "message": "Data extracted successfully",
  "data": { ... }
}
```

The `data` object must contain the following keys when the value exists in the document. All keys are optional at the root; return only what the extractor can reliably extract. Frontend will autopopulate the "Create New Shipment" form with these values.

---

## 1. Shipment info

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `piNo` | string | Proforma Invoice number | `"PI-2024-001"` |
| `piDate` | string | PI date (YYYY-MM-DD) | `"2024-03-01"` |
| `fpoNo` | string | Purchase Order / FPO number | `"PO-2024-456"` |
| `purchaseDate` | string | Order / purchase date (YYYY-MM-DD) | `"2024-03-05"` |
| `incoTerms` | string | Inco terms — one of: `CIF`, `FOB`, `EXWORKS` | `"CIF"` |
| `portOfLoading` | string | Port of loading | `"Karachi"` |
| `portOfDischarge` | string | Port of discharge | `"Dubai"` |
| `commodity` | string | Commodity — one of: `Rice`, `Wheat`, `Sugar`, `Maize`, `Soybean`, `Cotton`, `Pulses`, `Other` | `"Rice"` |
| `brandName` | string | Brand name | `"Royal Basmati"` |
| `itemDescription` | string | Full item/product description | `"Basmati Rice 25kg bags"` |

---

## 2. Supplier (for dropdown match)

The frontend will match the supplier dropdown by **supplierCode** (or fallback to **supplierName**). Return at least one so the UI can preselect the supplier.

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `supplierCode` | string | Supplier code (must match `Supplier.supplierCode` in DB) | `"SUP-001"` |
| `supplierName` | string | Supplier name (optional; used if supplierCode not matched) | `"Pakistan Rice Exporters"` |
| `countryOfOrigin` | string | Country of origin | `"Pakistan"` |

---

## 3. Item (for dropdown match)

The frontend will match the item dropdown by **itemCode** (or fallback to **itemDescription**). Return at least one so the UI can preselect the item.

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `itemCode` | string | Item code (must match `Item.itemCode` in DB) | `"RICE-25KG"` |
| (itemDescription) | string | Already in §1; can be used for item match if itemCode missing | — |

---

## 4. Quantity & packaging

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `packagingType` | string | e.g. bag type, pallet | `"25 Kg Bags"` |
| `containerSize` | string | `"20"` or `"40"` (feet) | `"40"` |
| `plannedContainers` | number | Total quantity in MT (metric tons) | `500` |
| `fcl` | number | Number of FCL (full container loads) | `20` |
| `pallet` | number | Number of pallets | `100` |
| `bags` | number | Number of bags | `20000` |
| `noOfShipments` | number | Number of shipments / containers | `20` |

---

## 5. Price & payment

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `buyingUnit` | string | UOM — one of: `MT`, `KG`, `Bag`, `Pallet` | `"MT"` |
| `fcPerUnit` | number | Foreign currency per unit (e.g. USD per MT) | `450` |
| `totalUSD` | number | Total amount in USD | `225000` |
| `totalAED` | number | Total amount in AED (optional; can be derived frontend-side) | `825750` |
| `paymentTerms` | string | One of: `100% CAD`, `Advance 100%`, `DA 30 days`, `20% Advance and 80% CAD` | `"20% Advance and 80% CAD"` |
| `advanceAmount` | number | Advance payment amount (e.g. USD) | `45000` |

---

## 6. Dates (shipment)

| Key | Type | Description | Example |
|-----|------|-------------|---------|
| `expectedETD` | string | Expected time of departure (YYYY-MM-DD) | `"2024-04-15"` |
| `expectedETA` | string | Expected time of arrival (YYYY-MM-DD) | `"2024-05-10"` |

---

## Example full response (mock)

```json
{
  "message": "Data extracted successfully",
  "data": {
    "piNo": "PI-2024-001",
    "piDate": "2024-03-01",
    "fpoNo": "PO-2024-456",
    "purchaseDate": "2024-03-05",
    "incoTerms": "CIF",
    "portOfLoading": "Karachi",
    "portOfDischarge": "Dubai",
    "commodity": "Rice",
    "brandName": "Royal Basmati",
    "itemDescription": "Basmati Rice 25kg bags",
    "supplierCode": "SUP-001",
    "supplierName": "Pakistan Rice Exporters",
    "itemCode": "RICE-25KG",
    "countryOfOrigin": "Pakistan",
    "packagingType": "25 Kg Bags",
    "containerSize": "40",
    "plannedContainers": 500,
    "fcl": 20,
    "pallet": 100,
    "bags": 20000,
    "noOfShipments": 20,
    "buyingUnit": "MT",
    "fcPerUnit": 450,
    "totalUSD": 225000,
    "totalAED": 825750,
    "paymentTerms": "20% Advance and 80% CAD",
    "advanceAmount": 45000,
    "expectedETD": "2024-04-15",
    "expectedETA": "2024-05-10"
  }
}
```

---

## Notes for Python service

- Return only keys for which a value was **confidently extracted**; omit keys that are missing or ambiguous.
- Dates must be **YYYY-MM-DD** strings.
- Numeric values: send as numbers (not strings) for `fcPerUnit`, `totalUSD`, `totalAED`, `advanceAmount`, `plannedContainers`, `fcl`, `pallet`, `bags`, `noOfShipments`.
- Dropdown values (`incoTerms`, `commodity`, `containerSize`, `buyingUnit`, `paymentTerms`) should match the exact option values used in the frontend (see table values above).
- When integrated, the Node API will send the uploaded file buffers to the Python service and expect this JSON shape in return.
