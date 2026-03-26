# ScaleSafe — Merchant Onboarding Funnel Build Instructions

## Overview
This document describes the merchant onboarding funnel in GHL — the funnel that new merchants fill out when they sign up for ScaleSafe. It collects their business info and branding so the account can be provisioned.

## The 4-Page Structure
Page 1: Business Profile
Page 2: Branding & Service Delivery
Page 3: Evidence Collection Setup (pre-built, do not change)
Page 4: Review & Confirm (pre-built, do not change)

## Page 1 — Business Profile
Page Title: "Business Profile"
Page Subtitle: "Tell us about your business so we can set up your ScaleSafe account."

12 fields:
1. First Name - Text, Required, maps to GHL built-in "First Name"
2. Last Name - Text, Required, maps to GHL built-in "Last Name"
3. Email - Email, Required, maps to GHL built-in "Email"
4. Business Legal Name - Text, Required, maps to Custom Value "Business Legal Name" (Additional Info folder)
5. DBA / Brand Name - Text, Required, maps to Custom Value "DBA / Brand Name" (Additional Info)
6. Support Email - Email, Required, maps to Custom Value "Merchant Support Email" (Onboarding Bridge)
7. Support Phone - Phone, Required, maps to GHL built-in "Phone"
8. Payment Descriptor - Text, Required, max 22 chars, maps to Custom Value "Merchant Descriptor" (Onboarding Bridge)
9. Industry / Niche - Dropdown, Required, Options: Coaching, Consulting, Online Courses, Digital Products, Professional Services, Health & Wellness, Other. Maps to Custom Value "Industry / Niche" (Additional Info)
10. Business Website - URL, Required, maps to Custom Value "Business Website" (Additional Info)
11. Business City - Text, Required, maps to Custom Value "Business City" (Additional Info)
12. Business State - Text, Required, maps to Custom Value "Business State" (Additional Info)

Button: "Next: Branding & Service Details →"

## Page 2 — Branding & Service Delivery
Page Title: "Branding & Service Delivery"

4 fields:
13. Business Logo - File Upload, Optional, maps to Custom Value "Business Logo" (Additional Info)
14. Short Business Description - Textarea, Required, maps to Custom Value "Short Business Description" (Additional Info)
15. Primary Service Type - Dropdown, Required, Options: 1-on-1 Coaching/Consulting, Group Programs, Online Courses/Self-Paced, Digital Products/Downloads, Hybrid/Multiple, Other. Maps to Custom Value "Primary Service Type" (Additional Info)
16. Platforms Used - Multi-select, Optional, Options: Zoom, Google Meet, Kajabi, Teachable, Thinkific, Skool, Custom Platform, In-Person, Other. Maps to Custom Value "Platforms Used" (Additional Info)

Button: "Next: Evidence Setup →"

## Pages 3 & 4
Pre-built, do not modify.

## Webhook Connection
Final form submission triggers webhook to S1 (Merchant Provisioning):
URL: https://hook.us1.make.com/i5l3p72t2gpu49s5s3qbsk8m49te05hp
Sends: location_id, business_name
NOTE: In the Node.js app, this webhook will be replaced by the app's provisioning endpoint.

## Field Mapping Summary Table

### Page 1:
| Form Field | Maps To | Location |
|------------|---------|----------|
| First Name | GHL "First Name" | Standard |
| Last Name | GHL "Last Name" | Standard |
| Email | GHL "Email" | Standard |
| Business Legal Name | CV "Business Legal Name" | Additional Info |
| DBA / Brand Name | CV "DBA / Brand Name" | Additional Info |
| Support Email | CV "Merchant Support Email" | Onboarding Bridge |
| Support Phone | GHL "Phone" | Standard |
| Payment Descriptor | CV "Merchant Descriptor" | Onboarding Bridge |
| Industry / Niche | CV "Industry / Niche" | Additional Info |
| Business Website | CV "Business Website" | Additional Info |
| Business City | CV "Business City" | Additional Info |
| Business State | CV "Business State" | Additional Info |

### Page 2:
| Form Field | Maps To | Location |
|------------|---------|----------|
| Business Logo | CV "Business Logo" | Additional Info |
| Short Business Desc | CV "Short Business Description" | Additional Info |
| Primary Service Type | CV "Primary Service Type" | Additional Info |
| Platforms Used | CV "Platforms Used" | Additional Info |

## Appendix A: S13 Service Access Tracking
After onboarding, S13 captures when clients access course content.
Webhook URL: https://hook.us1.make.com/p6g3lkpnjfl99xktzynj5cjh5cyo71p0
Make.com Scenario: 4618339
Required fields: location_id, contact_id, event_type
Optional: contact_name, contact_email, source, access_date, resource_accessed, duration_seconds, ip_address, user_agent
event_type options: login, view, download, completion

## Appendix B: SYS2-11 Cancellation Workflow
S12 Webhook URL: https://hook.us1.make.com/3gag0kx144wrg7qadus5j6zwxsfbxpur
Workflow trigger: Form "SYS2-11: Cancellation" (ID: s9LDdMzizx1VljRv2E3J)
JSON body maps: contact_id, location_id, full_name, email, request_type ("cancel"), request_channel ("Form"), request_text, cancel_reason
Form fields: Reason dropdown (Financial hardship, Not a good fit, Didn't see results, Personal reasons, Other), explanation textarea, acknowledgment checkbox, date.
