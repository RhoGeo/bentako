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
import Affiliate from './pages/Affiliate';
import CombinedView from './pages/CombinedView';
import Counter from './pages/Counter';
import CustomersDue from './pages/CustomersDue';
import Devices from './pages/Devices';
import AcceptInvite from './pages/AcceptInvite';
import Items from './pages/Items';
import More from './pages/More';
import OperatingPolicy from './pages/OperatingPolicy';
import Payouts from './pages/Payouts';
import Permissions from './pages/Permissions';
import ProductForm from './pages/ProductForm';
import Reports from './pages/Reports';
import RestockChecklist from './pages/RestockChecklist';
import SalesLog from './pages/SalesLog';
import Staff from './pages/Staff';
import StaffAssignments from './pages/StaffAssignments';
import StoreSettings from './pages/StoreSettings';
import StoreSwitcher from './pages/StoreSwitcher';
import SyncStatus from './pages/SyncStatus';
import Today from './pages/Today';
import Onboarding from './pages/Onboarding';
import MyStores from './pages/MyStores';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Affiliate": Affiliate,
    "CombinedView": CombinedView,
    "Counter": Counter,
    "CustomersDue": CustomersDue,
    "Devices": Devices,
    "AcceptInvite": AcceptInvite,
    "Items": Items,
    "More": More,
    "OperatingPolicy": OperatingPolicy,
    "Payouts": Payouts,
    "Permissions": Permissions,
    "ProductForm": ProductForm,
    "Reports": Reports,
    "RestockChecklist": RestockChecklist,
    "SalesLog": SalesLog,
    "Staff": Staff,
    "StaffAssignments": StaffAssignments,
    "StoreSettings": StoreSettings,
    "StoreSwitcher": StoreSwitcher,
    "SyncStatus": SyncStatus,
    "Today": Today,
    "Onboarding": Onboarding,
    "MyStores": MyStores,
}

export const pagesConfig = {
    mainPage: "Counter",
    Pages: PAGES,
    Layout: __Layout,
};