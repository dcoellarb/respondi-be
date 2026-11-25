# Address and schedule nesting

When answering WhatsApp messages, the bot needs a clear view of where the business is and when it is open. How the schedule is nested relative to addresses depends on how many addresses and how many schedules the account has.

This shape is what retrieval should produce for reply context. It is not about how the account form is edited in the API; it is about how location + hours are presented together when composing an answer.

## Rules

| Addresses | Schedules | Where the schedule lives |
| --- | --- | --- |
| One | One | Embedded on that single address object |
| Multiple | One | Nested on the **first** address only |
| Multiple | Multiple | Nested on **each** address |

Profile-level `scheduleMode` maps to these cases:

- `business` → one shared schedule (row 1 or 2 above, depending on address count)
- `per_address` → one schedule per address (row 3)

## Examples

### One address, one schedule

The address object carries the hours directly.

```json
{
  "addresses": [
    {
      "id": "addr_1",
      "line1": "123 Main St",
      "city": "Austin",
      "hours": [
        { "dayOfWeek": "monday", "start": "09:00", "end": "17:00" }
      ]
    }
  ]
}
```

### Multiple addresses, one schedule

The shared schedule is nested only on the first address. Other addresses omit hours (or leave them empty). Callers answering WhatsApp should treat that first address’s hours as the business-wide schedule.

```json
{
  "addresses": [
    {
      "id": "addr_1",
      "line1": "123 Main St",
      "city": "Austin",
      "hours": [
        { "dayOfWeek": "monday", "start": "09:00", "end": "17:00" }
      ]
    },
    {
      "id": "addr_2",
      "line1": "456 Oak Ave",
      "city": "Dallas",
      "hours": []
    }
  ]
}
```

### Multiple addresses, multiple schedules

Each address has its own hours. Use the hours on the address the customer is asking about.

```json
{
  "addresses": [
    {
      "id": "addr_1",
      "line1": "123 Main St",
      "city": "Austin",
      "hours": [
        { "dayOfWeek": "monday", "start": "09:00", "end": "17:00" }
      ]
    },
    {
      "id": "addr_2",
      "line1": "456 Oak Ave",
      "city": "Dallas",
      "hours": [
        { "dayOfWeek": "monday", "start": "10:00", "end": "18:00" }
      ]
    }
  ]
}
```

## Why this matters for WhatsApp

Inbound messages ask about open hours, location, and which branch applies. Nesting the schedule on address objects (and on the first address when there is only one shared schedule) keeps location and availability in one place for the reply path. Do not look for a separate top-level schedule when building that context; resolve hours from the address nesting rules above.
