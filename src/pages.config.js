/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import Counter from './pages/Counter';
import Today from './pages/Today';
import Reports from './pages/Reports';
import Items from './pages/Items';
import ProductForm from './pages/ProductForm';
import More from './pages/More';
import CustomersDue from './pages/CustomersDue';
import SyncStatus from './pages/SyncStatus';
import Staff from './pages/Staff';
import StoreSettings from './pages/StoreSettings';
import Devices from './pages/Devices';
import Affiliate from './pages/Affiliate';
import Payouts from './pages/Payouts';
import Permissions from './pages/Permissions';
import OperatingPolicy from './pages/OperatingPolicy';
import RestockChecklist from './pages/RestockChecklist';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Counter": Counter,
    "Today": Today,
    "Reports": Reports,
    "Items": Items,
    "ProductForm": ProductForm,
    "More": More,
    "CustomersDue": CustomersDue,
    "SyncStatus": SyncStatus,
    "Staff": Staff,
    "StoreSettings": StoreSettings,
    "Devices": Devices,
    "Affiliate": Affiliate,
    "Payouts": Payouts,
    "Permissions": Permissions,
    "OperatingPolicy": OperatingPolicy,
    "RestockChecklist": RestockChecklist,
}

export const pagesConfig = {
    mainPage: "Counter",
    Pages: PAGES,
    Layout: __Layout,
};