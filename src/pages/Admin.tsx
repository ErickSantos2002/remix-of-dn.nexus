import { Navigate } from "react-router-dom";

// Admin index page - redirects to templates management
const Admin = () => {
  return <Navigate to="/admin/templates" replace />;
};

export default Admin;
