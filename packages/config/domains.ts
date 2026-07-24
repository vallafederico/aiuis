const DEV_DOMAIN = "http://localhost:3000";
const PROD_DOMAIN = "https://aiu.is";

export const DOMAIN =
	process.env.NODE_ENV === "production" ? PROD_DOMAIN : DEV_DOMAIN;
