import { createBrowserRouter } from "react-router-dom";
import LandingPage from "./features/landing/pages/LandingPage";
import LoginPage from "./features/auth/pages/LoginPage";
import TopLayout from "./app/layouts/TopLayout";
import BalancePage from "./features/assets/pages/BalancePage";
import HouseholdCategoryPage from "./features/household/pages/HouseholdCategoryPage";
import HouseholdExpensePage from "./features/household/pages/HouseholdExpensePage";
import HouseholdPage from "./features/household/pages/HouseholdPage";
import HouseholdAnnualPage from "./features/household/pages/HouseholdAnnualPage";
import CreditCardPage from "./features/credit_cards/pages/CreditCardPage";
import { MonthProvider } from "./features/shared/state/MonthContext";
import { ProtectedRoute, RedirectIfAuthenticated } from "./routeGuards";


export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/login",
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    element: (
      <ProtectedRoute>
        <MonthProvider>
          <TopLayout />
        </MonthProvider>
      </ProtectedRoute>
    ),
    children: [
      {
        path: "household",
        children: [
          {
            index: true,
            element: <HouseholdPage />,
          },
          {
            path: "categories",
            element: <HouseholdCategoryPage />,
          },
          {
            path: "expenses",
            element: <HouseholdExpensePage />,
          },
          {
            path: "annual",
            element: <HouseholdAnnualPage />,
          },
        ],
      },
      {
        path: "balance",
        element: <BalancePage />,
      },
      {
        path: "cards",
        element: <CreditCardPage />,
      },
    ],
  },
], { basename: import.meta.env.BASE_URL });
