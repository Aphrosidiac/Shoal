import Fastify from 'fastify'
import { CSS, JS, page } from './html.js'
import { currentUser } from './auth.js'
import authRoutes from './routes/auth.js'
import customerRoutes from './routes/customers.js'
import orderRoutes from './routes/orders.js'
import invoiceRoutes from './routes/invoices.js'
import paymentRoutes from './routes/payments.js'
import reportRoutes from './routes/reports.js'
import adminRoutes from './routes/admin.js'
import deliveryRoutes from './routes/deliveries.js'

const PORT = Number(process.env.LEAKY_PORT ?? 4100)
const app = Fastify({ logger: false, bodyLimit: 4 * 1024 * 1024 })

// BUG 11: the error handler puts the raw stack trace in the response body.
app.setErrorHandler((err, _req, reply) => {
  const status = (err as { statusCode?: number }).statusCode ?? 500
  if (status < 500) return reply.code(status).send({ error: err.message })
  return reply.code(500).send({
    error: 'Internal Server Error',
    message: err.message,
    stack: err.stack,
    query: (err as { query?: string }).query ?? null,
  })
})

app.get('/static/app.css', async (_req, reply) => reply.type('text/css').send(CSS))
app.get('/static/app.js', async (_req, reply) => reply.type('application/javascript').send(JS))
app.get('/health', async () => ({ ok: true, app: 'leaky', version: process.env.LEAKY_VERSION ?? '1' }))

await app.register(authRoutes)
await app.register(customerRoutes)
await app.register(orderRoutes)
await app.register(invoiceRoutes)
await app.register(paymentRoutes)
await app.register(reportRoutes)
await app.register(adminRoutes)
await app.register(deliveryRoutes)

// ---------- pages ----------
type Ctx = { id?: string }
const pub: Record<string, (c: Ctx) => string> = {
  '/': () =>
    page({
      nav: false,
      title: 'Leaky',
      heading: 'Leaky — orders, invoices and payments',
      body: `<p>A small back office for a small business. Track customers, raise orders, invoice them, take payments.</p>
<p><a href="/register">Create an account</a> or <a href="/login">log in</a>.</p>
<h2>More</h2>
<ul><li><a href="/pricing">Pricing</a></li><li><a href="/about">About</a></li><li><a href="/contact">Contact</a></li><li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li></ul>`,
    }),
  '/pricing': () =>
    page({ nav: false, title: 'Pricing', body: `<h2>Free</h2><p>Everything, for nothing, because this app is not real.</p><p><a href="/register">Create an account</a></p><p><a href="/">Back to the home page</a></p>` }),
  '/about': () => page({ nav: false, title: 'About', body: `<p>Leaky is a deliberately imperfect demo application.</p><p><a href="/">Back to the home page</a></p>` }),
  '/contact': () =>
    page({ nav: false, title: 'Contact', body: `<form data-action="/api/noop" data-method="POST"><label>Your email<input name="email" type="email"></label><label>Message<textarea name="message"></textarea></label><button type="submit">Send message</button></form><p><a href="/">Back to the home page</a></p>` }),
  '/terms': () => page({ nav: false, title: 'Terms', body: `<p>Do not use this in production. There is no production.</p><p><a href="/">Back to the home page</a></p>` }),
  '/privacy': () => page({ nav: false, title: 'Privacy', body: `<p>Everything stays on this machine.</p><p><a href="/">Back to the home page</a></p>` }),
  '/register': () =>
    page({
      nav: false,
      title: 'Create your account',
      body: `<form data-action="/api/auth/register" data-method="POST" data-redirect="/app">
<label>Email<input name="email" type="email" autocomplete="email" required></label>
<label>Password<input name="password" type="password" autocomplete="new-password" required minlength="6"></label>
<label>Your name<input name="name" type="text" autocomplete="name"></label>
<button type="submit">Create account</button></form>
<p>Already have one? <a href="/login">Log in</a>.</p>`,
    }),
  '/login': () =>
    page({
      nav: false,
      title: 'Log in',
      body: `<form data-action="/api/auth/login" data-method="POST" data-redirect="/app">
<label>Email<input name="email" type="email" autocomplete="email" required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Log in</button></form>
<p>No account yet? <a href="/register">Create one</a>.</p>`,
    }),
}

const priv: Record<string, (c: Ctx) => string> = {
  '/app': () =>
    page({
      title: 'Dashboard',
      body: `<p>Welcome back. Here is what is open.</p>
<h2>Recent orders</h2><div data-list="/api/orders" data-cols="id,ref,qty,price" data-link="/app/orders/"></div>
<h2>Recent invoices</h2><div data-list="/api/invoices" data-cols="id,ref,total,paid_amt,status" data-link="/app/invoices/"></div>
<p><a href="/app/orders/new">Raise a new order</a> · <a href="/app/customers/new">Add a customer</a> · <a href="/app/search">Search</a> · <a href="/app/notifications">Notifications</a> · <a href="/app/help">Help</a></p>`,
    }),
  '/app/customers': () =>
    page({
      title: 'Customers',
      body: `<p><a href="/app/customers/new">Add a customer</a></p>
<div data-list="/api/customers" data-cols="id,name,email,phone" data-link="/app/customers/"></div>`,
    }),
  '/app/customers/new': () =>
    page({
      title: 'Add a customer',
      body: `<form data-action="/api/customers" data-method="POST" data-redirect="/app/customers/:id">
<label>Name<input name="name" type="text" required></label>
<label>Email<input name="email" type="email"></label>
<label>Phone<input name="phone" type="text"></label>
<label>Notes<textarea name="notes"></textarea></label>
<button type="submit">Save customer</button></form>
<p><a href="/app/customers">Back to customers</a></p>`,
    }),
  '/app/orders': () =>
    page({
      title: 'Orders',
      body: `<p><a href="/app/orders/new">Raise a new order</a></p>
<div data-list="/api/orders" data-cols="id,ref,qty,price,notes" data-link="/app/orders/"></div>
<div class="pager" id="pager"></div>`,
    }),
  '/app/orders/new': () =>
    page({
      title: 'Raise an order',
      body: `<form data-action="/api/orders" data-method="POST" data-idem="1" data-redirect="/app/orders/:id">
<label>Reference<input name="ref" type="text"></label>
<label>Quantity<input name="qty" type="number" value="1"></label>
<label>Unit price<input name="price" type="number" step="0.01" value="100"></label>
<label>Notes<input name="notes" type="text"></label>
<button type="submit">Create order</button></form>
<p><a href="/app/orders">Back to orders</a></p>`,
    }),
  '/app/invoices': () =>
    page({
      title: 'Invoices',
      body: `<div data-list="/api/invoices" data-cols="id,ref,total,paid_amt,status" data-link="/app/invoices/"></div>
<div class="pager" id="pager"></div>`,
    }),
  '/app/deliveries': () =>
    page({
      title: 'Deliveries',
      body: `<h2>Book a slot</h2>
<form data-action="/api/deliveries" data-method="POST">
<label>Slot<select name="slot"><option value="mon-am">mon-am</option><option value="mon-pm">mon-pm</option><option value="tue-am">tue-am</option><option value="tue-pm">tue-pm</option><option value="wed-am">wed-am</option></select></label>
<label>Address<input name="address" type="text"></label>
<button type="submit">Book delivery</button></form>
<h2>Slots</h2><div data-list="/api/slots" data-cols="label,capacity,booked"></div>
<h2>Booked</h2><div data-list="/api/deliveries" data-cols="id,slot,address"></div>`,
    }),
  '/app/reports': () =>
    page({
      title: 'Reports',
      body: `<form data-action="/api/reports/summary" data-method="GET">
<label>From<input name="from" type="text" placeholder="2026-01-01"></label>
<label>To<input name="to" type="text" placeholder="2026-12-31"></label>
<button type="submit">Run report</button></form>
<div data-one="/api/reports/summary"></div>
<p><a href="/app/reports/aging">Aging report</a></p>`,
    }),
  '/app/reports/aging': () =>
    page({ title: 'Aging report', body: `<div data-list="/api/invoices" data-cols="id,ref,total,paid_amt,status"></div><p><a href="/app/reports">Back to reports</a></p>` }),
  '/app/admin': () =>
    page({
      title: 'Admin',
      body: `<p>Administrative tools.</p>
<ul><li><a href="/api/admin/export">Export everything</a></li><li><a href="/api/admin/settings">Instance settings</a></li><li><a href="/api/admin/users">All users</a></li></ul>
<div data-one="/api/admin/settings"></div>`,
    }),
  '/app/settings': () =>
    page({
      title: 'Settings',
      body: `<form data-action="/api/noop" data-method="POST">
<label>Business name<input name="business" type="text"></label>
<label>Currency<select name="currency"><option>MYR</option><option>USD</option></select></label>
<button type="submit">Save settings</button></form>`,
    }),
  '/app/profile': () => page({ title: 'Your profile', body: `<div data-one="/api/me"></div>` }),
  '/app/team': () =>
    page({
      title: 'Team',
      body: `<p>Invite someone to your account.</p>
<form data-action="/api/noop" data-method="POST"><label>Email<input name="email" type="email"></label><button type="submit">Send invite</button></form>`,
    }),
  '/app/search': () =>
    page({
      title: 'Search',
      body: `<form data-action="/api/noop" data-method="GET"><label>Query<input name="q" type="search"></label><button type="submit">Search</button></form>
<div data-list="/api/customers" data-cols="id,name,email"></div>`,
    }),
  '/app/help': () => page({ title: 'Help', body: `<h2>Getting started</h2><ol><li>Add a customer</li><li>Raise an order</li><li>Take a payment against the invoice</li></ol><p><a href="/app">Back to the dashboard</a></p>` }),
  '/app/notifications': () => page({ title: 'Notifications', body: `<p>Nothing needs your attention.</p><p><a href="/app">Back to the dashboard</a></p>` }),
}

for (const [path, render] of Object.entries(pub)) {
  app.get(path, async (_req, reply) => reply.type('text/html').send(render({})))
}
for (const [path, render] of Object.entries(priv)) {
  app.get(path, async (req, reply) => {
    if (!currentUser(req)) return reply.redirect('/login')
    return reply.type('text/html').send(render({}))
  })
}

app.get('/app/customers/:id', async (req, reply) => {
  if (!currentUser(req)) return reply.redirect('/login')
  const id = (req.params as { id: string }).id
  return reply.type('text/html').send(
    page({
      title: 'Customer',
      heading: 'Customer ' + id,
      body: `<div data-one="/api/customers/${id}"></div>
<h2>Edit</h2>
<form data-action="/api/customers/${id}" data-method="PATCH" data-reset="no">
<label>Name<input name="name" type="text" data-fill="name"></label>
<label>Email<input name="email" type="email" data-fill="email"></label>
<label>Phone<input name="phone" type="text" data-fill="phone"></label>
<label>Notes<input name="notes" type="text" data-fill="notes"></label>
<button type="submit">Save changes</button></form>
<p><a href="/app/customers">Back to customers</a></p>`,
    })
  )
})

app.get('/app/orders/:id', async (req, reply) => {
  if (!currentUser(req)) return reply.redirect('/login')
  const id = (req.params as { id: string }).id
  return reply.type('text/html').send(
    page({
      title: 'Order',
      heading: 'Order ' + id,
      body: `<div data-one="/api/orders/${id}"></div>
<p><a href="/app/orders">Back to orders</a> · <a href="/app/invoices">Invoices</a></p>`,
    })
  )
})

app.get('/app/invoices/:id', async (req, reply) => {
  if (!currentUser(req)) return reply.redirect('/login')
  const id = (req.params as { id: string }).id
  return reply.type('text/html').send(
    page({
      title: 'Invoice',
      heading: 'Invoice ' + id,
      body: `<div data-one="/api/invoices/${id}"></div>
<h2>Payments</h2><div data-list="/api/invoices/${id}/payments" data-cols="id,amount,method,reference"></div>
<p><a href="/app/invoices/${id}/pay">Take a payment</a> · <a href="/app/invoices">Back to invoices</a></p>
<h2>Set status</h2>
<form data-action="/api/invoices/${id}/status" data-method="POST">
<label>Status<select name="status"><option>UNPAID</option><option>PARTIAL</option><option>PAID</option><option>VOID</option></select></label>
<button type="submit">Set status</button></form>`,
    })
  )
})

app.get('/app/invoices/:id/pay', async (req, reply) => {
  if (!currentUser(req)) return reply.redirect('/login')
  const id = (req.params as { id: string }).id
  return reply.type('text/html').send(
    page({
      title: 'Take a payment',
      heading: 'Take a payment on invoice ' + id,
      body: `<div data-one="/api/invoices/${id}"></div>
<form data-action="/api/invoices/${id}/payments" data-method="POST">
<label>Amount<input name="amount" type="number" step="0.01" required></label>
<label>Method<select name="method"><option>card</option><option>bank</option><option>cash</option></select></label>
<label>Reference<input name="reference" type="text"></label>
<button type="submit">Record payment</button></form>
<p><a href="/app/invoices/${id}">Back to the invoice</a></p>`,
    })
  )
})

// A stub the marketing forms post at, so a submit does something ordinary.
app.route({ method: ['GET', 'POST'], url: '/api/noop', handler: async () => ({ ok: true }) })

app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'no such endpoint' })
  return reply.code(404).type('text/html').send(page({ nav: false, title: 'Not found', body: '<p><a href="/">Back to the home page</a></p>' }))
})

await app.listen({ port: PORT, host: '127.0.0.1' })
console.log(`leaky listening on http://localhost:${PORT}`)
