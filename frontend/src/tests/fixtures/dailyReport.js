/**
 * Synthetic but structurally real reports, produced by running the backend's
 * own buildReport() over a seeded fake database. Regenerate rather than
 * hand-edit, so the fixtures can never drift from the API they stand in for.
 *
 *   dailyReport  both channels, one day   -> 5 sheets, hourly
 *   rangeReport  both channels, two days  -> 5 sheets, daily
 *   callsReport  calls only, one day      -> 3 sheets
 *   emailsReport mails only, one day      -> 3 sheets
 */
export const dailyReport  = {
  "from": "2026-08-18",
  "to": "2026-08-18",
  "days": 1,
  "channel": "all",
  "granularity": "hour",
  "previousFrom": "2026-08-17",
  "previousTo": "2026-08-17",
  "generatedAt": "2026-08-18T12:33:37.687Z",
  "calls": {
    "total": 93,
    "answered": 75,
    "missed": 18,
    "pending": 3,
    "resolved": {
      "total": 49,
      "categories": [
        {
          "category": "Login & Account Access",
          "count": 8,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 8
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 8,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 8
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 6,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 6
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 6,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 6,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 6
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 6,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 5,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 5
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 4,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 4
            }
          ]
        }
      ],
      "mentions": 49,
      "reserved": 0
    },
    "unresolved": {
      "total": 23,
      "categories": [
        {
          "category": "Uploads & Documents",
          "count": 5,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 5
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 4,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 4
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 3,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 3
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 3,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 3
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 3,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 3
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 2,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 1,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 23,
      "reserved": 0
    }
  },
  "emails": {
    "total": 40,
    "repliedResolved": {
      "total": 14,
      "categories": [
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 2,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 1,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 1,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 14,
      "reserved": 0
    },
    "repliedUnresolved": {
      "total": 19,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 3,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 3
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 3,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 3
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 3,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 3
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        }
      ],
      "mentions": 19,
      "reserved": 0
    },
    "notReplied": {
      "total": 7,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 1,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 1
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 1,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 1
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 1,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 1
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 1,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 1
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 1,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 1
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 1,
          "subs": [
            {
              "sub_category": "Money Debited but Application Incomplete",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 1,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 7,
      "reserved": 0
    }
  },
  "issueShare": [
    {
      "category": "Uploads & Documents",
      "count": 18,
      "pct": 15.7
    },
    {
      "category": "Login & Account Access",
      "count": 17,
      "pct": 14.8
    },
    {
      "category": "Educational Qualifications",
      "count": 15,
      "pct": 13
    },
    {
      "category": "Identity Verification",
      "count": 15,
      "pct": 13
    },
    {
      "category": "Exam Information",
      "count": 13,
      "pct": 11.3
    },
    {
      "category": "Payment & Fee",
      "count": 13,
      "pct": 11.3
    },
    {
      "category": "Admit Card & Certificate",
      "count": 12,
      "pct": 10.4
    },
    {
      "category": "Amendment & Post-Submission",
      "count": 12,
      "pct": 10.4
    }
  ],
  "issueMentions": 115,
  "timeline": {
    "calls": {
      "current": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 9,
          "topCategory": "Uploads & Documents"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 14,
          "topCategory": "Identity Verification"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 17,
          "topCategory": "Login & Account Access"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 11,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 9,
          "topCategory": "Payment & Fee"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 12,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 8,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 4,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ],
      "previous": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 2,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 9,
          "topCategory": "Identity Verification"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 11,
          "topCategory": "Exam Information"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 8,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 5,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 7,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 8,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 6,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ]
    },
    "emails": {
      "current": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 4,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 7,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 9,
          "topCategory": "Uploads & Documents"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 5,
          "topCategory": "Login & Account Access"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 3,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 4,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 2,
          "topCategory": "Identity Verification"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ],
      "previous": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 5,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 4,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 4,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 3,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ]
    }
  },
  "feedback": {
    "calls": [
      {
        "category": "Uploads & Documents",
        "total": 13,
        "firstTouch": 8,
        "resolvedCount": 2,
        "avgResolutionMins": 90,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 13
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 11,
        "firstTouch": 8,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 11
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 10,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 10
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 9,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 9
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 8,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 8
          }
        ]
      },
      {
        "category": "Admit Card & Certificate",
        "total": 7,
        "firstTouch": 5,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 7
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 7,
        "firstTouch": 4,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 7
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 7,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 7
          }
        ]
      }
    ],
    "emails": [
      {
        "category": "Admit Card & Certificate",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 5
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 5
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 5
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 5
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 5
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 5
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 4
          },
          {
            "sub_category": "Money Debited but Application Incomplete",
            "count": 1
          }
        ]
      },
      {
        "category": "Uploads & Documents",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 5
          }
        ]
      }
    ]
  },
  "caveats": {
    "sentMailVisible": true,
    "followUpMailTracked": false,
    "callsWithTickets": 13,
    "emailsWithTickets": 18
  }
};

export const rangeReport  = {
  "from": "2026-08-17",
  "to": "2026-08-18",
  "days": 2,
  "channel": "all",
  "granularity": "day",
  "previousFrom": "2026-08-15",
  "previousTo": "2026-08-16",
  "generatedAt": "2026-08-18T12:33:37.689Z",
  "calls": {
    "total": 158,
    "answered": 140,
    "missed": 18,
    "pending": 68,
    "resolved": {
      "total": 49,
      "categories": [
        {
          "category": "Login & Account Access",
          "count": 8,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 8
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 8,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 8
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 6,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 6
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 6,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 6,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 6
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 6,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 5,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 5
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 4,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 4
            }
          ]
        }
      ],
      "mentions": 49,
      "reserved": 0
    },
    "unresolved": {
      "total": 23,
      "categories": [
        {
          "category": "Uploads & Documents",
          "count": 5,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 5
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 4,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 4
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 3,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 3
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 3,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 3
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 3,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 3
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 2,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 1,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 23,
      "reserved": 0
    }
  },
  "emails": {
    "total": 65,
    "repliedResolved": {
      "total": 14,
      "categories": [
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 2,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 1,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 1,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 14,
      "reserved": 0
    },
    "repliedUnresolved": {
      "total": 19,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 3,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 3
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 3,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 3
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 3,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 3
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        }
      ],
      "mentions": 19,
      "reserved": 0
    },
    "notReplied": {
      "total": 32,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 5,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 5
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 5,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 5
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 4,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 4
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 4,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 4
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 4,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 4
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 4,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 3
            },
            {
              "sub_category": "Money Debited but Application Incomplete",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 4,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 4
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 2,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 2
            }
          ]
        }
      ],
      "mentions": 32,
      "reserved": 0
    }
  },
  "issueShare": [
    {
      "category": "Uploads & Documents",
      "count": 30,
      "pct": 14.6
    },
    {
      "category": "Educational Qualifications",
      "count": 28,
      "pct": 13.7
    },
    {
      "category": "Login & Account Access",
      "count": 28,
      "pct": 13.7
    },
    {
      "category": "Identity Verification",
      "count": 26,
      "pct": 12.7
    },
    {
      "category": "Exam Information",
      "count": 24,
      "pct": 11.7
    },
    {
      "category": "Payment & Fee",
      "count": 24,
      "pct": 11.7
    },
    {
      "category": "Admit Card & Certificate",
      "count": 23,
      "pct": 11.2
    },
    {
      "category": "Amendment & Post-Submission",
      "count": 22,
      "pct": 10.7
    }
  ],
  "issueMentions": 205,
  "timeline": {
    "calls": {
      "current": [
        {
          "key": "2026-08-17",
          "label": "17/08",
          "count": 65,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "2026-08-18",
          "label": "18/08",
          "count": 93,
          "topCategory": "Uploads & Documents"
        }
      ],
      "previous": [
        {
          "key": "2026-08-15",
          "label": "15/08",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "2026-08-16",
          "label": "16/08",
          "count": 0,
          "topCategory": null
        }
      ]
    },
    "emails": {
      "current": [
        {
          "key": "2026-08-17",
          "label": "17/08",
          "count": 25,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "2026-08-18",
          "label": "18/08",
          "count": 40,
          "topCategory": "Admit Card & Certificate"
        }
      ],
      "previous": [
        {
          "key": "2026-08-15",
          "label": "15/08",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "2026-08-16",
          "label": "16/08",
          "count": 0,
          "topCategory": null
        }
      ]
    }
  },
  "feedback": {
    "calls": [
      {
        "category": "Uploads & Documents",
        "total": 13,
        "firstTouch": 8,
        "resolvedCount": 2,
        "avgResolutionMins": 90,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 13
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 11,
        "firstTouch": 8,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 11
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 10,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 10
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 9,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 9
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 8,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 8
          }
        ]
      },
      {
        "category": "Admit Card & Certificate",
        "total": 7,
        "firstTouch": 5,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 7
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 7,
        "firstTouch": 4,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 7
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 7,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 7
          }
        ]
      }
    ],
    "emails": [
      {
        "category": "Admit Card & Certificate",
        "total": 9,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 9
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 9,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 9
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 8,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 8
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 8,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 8
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 8,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 8
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 8,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 7
          },
          {
            "sub_category": "Money Debited but Application Incomplete",
            "count": 1
          }
        ]
      },
      {
        "category": "Uploads & Documents",
        "total": 8,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 8
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 7,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 7
          }
        ]
      }
    ]
  },
  "caveats": {
    "sentMailVisible": true,
    "followUpMailTracked": false,
    "callsWithTickets": 13,
    "emailsWithTickets": 18
  }
};

export const callsReport  = {
  "from": "2026-08-18",
  "to": "2026-08-18",
  "days": 1,
  "channel": "calls",
  "granularity": "hour",
  "previousFrom": "2026-08-17",
  "previousTo": "2026-08-17",
  "generatedAt": "2026-08-18T12:33:37.690Z",
  "calls": {
    "total": 93,
    "answered": 75,
    "missed": 18,
    "pending": 3,
    "resolved": {
      "total": 49,
      "categories": [
        {
          "category": "Login & Account Access",
          "count": 8,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 8
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 8,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 8
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 6,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 6
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 6,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 6,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 6
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 6,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 6
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 5,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 5
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 4,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 4
            }
          ]
        }
      ],
      "mentions": 49,
      "reserved": 0
    },
    "unresolved": {
      "total": 23,
      "categories": [
        {
          "category": "Uploads & Documents",
          "count": 5,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 5
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 4,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 4
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 3,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 3
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 3,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 3
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 3,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 3
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 2,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 1,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 23,
      "reserved": 0
    }
  },
  "emails": null,
  "issueShare": [
    {
      "category": "Uploads & Documents",
      "count": 13,
      "pct": 17.3
    },
    {
      "category": "Login & Account Access",
      "count": 12,
      "pct": 16
    },
    {
      "category": "Educational Qualifications",
      "count": 10,
      "pct": 13.3
    },
    {
      "category": "Identity Verification",
      "count": 10,
      "pct": 13.3
    },
    {
      "category": "Exam Information",
      "count": 8,
      "pct": 10.7
    },
    {
      "category": "Payment & Fee",
      "count": 8,
      "pct": 10.7
    },
    {
      "category": "Admit Card & Certificate",
      "count": 7,
      "pct": 9.3
    },
    {
      "category": "Amendment & Post-Submission",
      "count": 7,
      "pct": 9.3
    }
  ],
  "issueMentions": 75,
  "timeline": {
    "calls": {
      "current": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 9,
          "topCategory": "Uploads & Documents"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 14,
          "topCategory": "Identity Verification"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 17,
          "topCategory": "Login & Account Access"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 11,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 9,
          "topCategory": "Payment & Fee"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 12,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 8,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 4,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ],
      "previous": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 2,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 9,
          "topCategory": "Identity Verification"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 11,
          "topCategory": "Exam Information"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 8,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 5,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 7,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 8,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 6,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ]
    },
    "emails": null
  },
  "feedback": {
    "calls": [
      {
        "category": "Uploads & Documents",
        "total": 13,
        "firstTouch": 8,
        "resolvedCount": 2,
        "avgResolutionMins": 90,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 13
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 11,
        "firstTouch": 8,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 11
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 10,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 10
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 9,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 9
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 8,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 8
          }
        ]
      },
      {
        "category": "Admit Card & Certificate",
        "total": 7,
        "firstTouch": 5,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 7
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 7,
        "firstTouch": 4,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 7
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 7,
        "firstTouch": 6,
        "resolvedCount": 1,
        "avgResolutionMins": 55,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 7
          }
        ]
      }
    ],
    "emails": null
  },
  "caveats": {
    "sentMailVisible": null,
    "followUpMailTracked": false,
    "callsWithTickets": 13,
    "emailsWithTickets": null
  }
};

export const emailsReport = {
  "from": "2026-08-18",
  "to": "2026-08-18",
  "days": 1,
  "channel": "emails",
  "granularity": "hour",
  "previousFrom": "2026-08-17",
  "previousTo": "2026-08-17",
  "generatedAt": "2026-08-18T12:33:37.692Z",
  "calls": null,
  "emails": {
    "total": 40,
    "repliedResolved": {
      "total": 14,
      "categories": [
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 2,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Admit Card & Certificate",
          "count": 1,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 1,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 14,
      "reserved": 0
    },
    "repliedUnresolved": {
      "total": 19,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 3,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 3
            }
          ]
        },
        {
          "category": "Identity Verification",
          "count": 3,
          "subs": [
            {
              "sub_category": "Name Prefix Mismatch (KM / Kumari)",
              "count": 3
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 3,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 3
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 2,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 2
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 2,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 2
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 2,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 2
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 2,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 2
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 2,
          "subs": [
            {
              "sub_category": "Duplicate Payment Refund Query",
              "count": 2
            }
          ]
        }
      ],
      "mentions": 19,
      "reserved": 0
    },
    "notReplied": {
      "total": 7,
      "categories": [
        {
          "category": "Admit Card & Certificate",
          "count": 1,
          "subs": [
            {
              "sub_category": "Admit Card Download Process",
              "count": 1
            }
          ]
        },
        {
          "category": "Amendment & Post-Submission",
          "count": 1,
          "subs": [
            {
              "sub_category": "Correction Window Already Closed",
              "count": 1
            }
          ]
        },
        {
          "category": "Educational Qualifications",
          "count": 1,
          "subs": [
            {
              "sub_category": "Board / University Not in Dropdown",
              "count": 1
            }
          ]
        },
        {
          "category": "Exam Information",
          "count": 1,
          "subs": [
            {
              "sub_category": "Exam Pattern & Structure Query",
              "count": 1
            }
          ]
        },
        {
          "category": "Login & Account Access",
          "count": 1,
          "subs": [
            {
              "sub_category": "OTR ID Forgotten / Recovery",
              "count": 1
            }
          ]
        },
        {
          "category": "Payment & Fee",
          "count": 1,
          "subs": [
            {
              "sub_category": "Money Debited but Application Incomplete",
              "count": 1
            }
          ]
        },
        {
          "category": "Uploads & Documents",
          "count": 1,
          "subs": [
            {
              "sub_category": "File Too Large Error",
              "count": 1
            }
          ]
        }
      ],
      "mentions": 7,
      "reserved": 0
    }
  },
  "issueShare": [
    {
      "category": "Admit Card & Certificate",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Amendment & Post-Submission",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Educational Qualifications",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Exam Information",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Identity Verification",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Login & Account Access",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Payment & Fee",
      "count": 5,
      "pct": 12.5
    },
    {
      "category": "Uploads & Documents",
      "count": 5,
      "pct": 12.5
    }
  ],
  "issueMentions": 40,
  "timeline": {
    "calls": null,
    "emails": {
      "current": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 4,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 7,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 9,
          "topCategory": "Uploads & Documents"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 5,
          "topCategory": "Login & Account Access"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 3,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 4,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 2,
          "topCategory": "Identity Verification"
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ],
      "previous": [
        {
          "key": "00",
          "label": "00:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "01",
          "label": "01:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "02",
          "label": "02:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "03",
          "label": "03:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "04",
          "label": "04:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "05",
          "label": "05:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "06",
          "label": "06:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "07",
          "label": "07:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "08",
          "label": "08:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "09",
          "label": "09:00",
          "count": 3,
          "topCategory": "Educational Qualifications"
        },
        {
          "key": "10",
          "label": "10:00",
          "count": 5,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "11",
          "label": "11:00",
          "count": 6,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "12",
          "label": "12:00",
          "count": 4,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "13",
          "label": "13:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "14",
          "label": "14:00",
          "count": 4,
          "topCategory": "Admit Card & Certificate"
        },
        {
          "key": "15",
          "label": "15:00",
          "count": 3,
          "topCategory": "Amendment & Post-Submission"
        },
        {
          "key": "16",
          "label": "16:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "17",
          "label": "17:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "18",
          "label": "18:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "19",
          "label": "19:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "20",
          "label": "20:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "21",
          "label": "21:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "22",
          "label": "22:00",
          "count": 0,
          "topCategory": null
        },
        {
          "key": "23",
          "label": "23:00",
          "count": 0,
          "topCategory": null
        }
      ]
    }
  },
  "feedback": {
    "calls": null,
    "emails": [
      {
        "category": "Admit Card & Certificate",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "Admit Card Download Process",
            "count": 5
          }
        ]
      },
      {
        "category": "Amendment & Post-Submission",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Correction Window Already Closed",
            "count": 5
          }
        ]
      },
      {
        "category": "Educational Qualifications",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Board / University Not in Dropdown",
            "count": 5
          }
        ]
      },
      {
        "category": "Exam Information",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Exam Pattern & Structure Query",
            "count": 5
          }
        ]
      },
      {
        "category": "Identity Verification",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Name Prefix Mismatch (KM / Kumari)",
            "count": 5
          }
        ]
      },
      {
        "category": "Login & Account Access",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "OTR ID Forgotten / Recovery",
            "count": 5
          }
        ]
      },
      {
        "category": "Payment & Fee",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 2,
        "avgResolutionMins": 52,
        "subs": [
          {
            "sub_category": "Duplicate Payment Refund Query",
            "count": 4
          },
          {
            "sub_category": "Money Debited but Application Incomplete",
            "count": 1
          }
        ]
      },
      {
        "category": "Uploads & Documents",
        "total": 5,
        "firstTouch": 0,
        "resolvedCount": 1,
        "avgResolutionMins": 35,
        "subs": [
          {
            "sub_category": "File Too Large Error",
            "count": 5
          }
        ]
      }
    ]
  },
  "caveats": {
    "sentMailVisible": true,
    "followUpMailTracked": false,
    "callsWithTickets": null,
    "emailsWithTickets": 18
  }
};
