import Helmet from 'helmet'

export const helmet = Helmet({
  referrerPolicy: {
    policy: 'no-referrer'
  },
  dnsPrefetchControl: {
    allow: false
  },
  permittedCrossDomainPolicies: false,
  contentSecurityPolicy: {},
  hsts: false,
  xssFilter: false
})
