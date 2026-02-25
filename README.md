**Welcome to your Base44 project** 

**About**

View and Edit  your app on [Base44.com](http://Base44.com) 

This project contains everything you need to run your app locally.

**Edit the code in your local development environment**

Any change pushed to the repo will also be reflected in the Base44 Builder.

**Prerequisites:** 

1. Clone the repository using the project's Git URL 
2. Navigate to the project directory
3. Install dependencies: `npm install`
4. Create an `.env.local` file and set the right environment variables

```
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url

e.g.
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

Run the app: `npm run dev`

---

## Base44 Data Model Requirements (for full feature set)

This repo expects certain entities/fields to exist in your Base44 app schema.

### 1) `StoreSettings.is_archived`

Used by **Archive Store** flow to hide a store from the store picker.

Add these fields to the `StoreSettings` entity:

- `is_archived` (boolean, default: false)
- `archived_at` (string/ISO datetime, nullable)

### 2) `StaffInvite` entity (for Invite Staff flow)

Create a new entity/table named `StaffInvite` with at least:

- `store_id` (string)
- `invite_email` (string)
- `role` (string: owner/manager/cashier)
- `invite_token` (string, unique)
- `status` (string: pending/accepted/revoked)
- `invited_by_email` (string)
- `expires_at` (string/ISO datetime)
- `created_at` (string/ISO datetime)
- `accepted_at` (string/ISO datetime, nullable)
- `accepted_by_email` (string, nullable)
- `revoked_at` (string/ISO datetime, nullable)

If these are missing, the related functions will return `SCHEMA_MISSING`.

**Publish your changes**

Open [Base44.com](http://Base44.com) and click on Publish.

**Docs & Support**

Documentation: [https://docs.base44.com/Integrations/Using-GitHub](https://docs.base44.com/Integrations/Using-GitHub)

Support: [https://app.base44.com/support](https://app.base44.com/support)
