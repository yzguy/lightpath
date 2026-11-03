# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Learners and engineers who design or want to understand DWDM (dense wavelength-division multiplexing) optical links: network and optical engineers, students, and people building or studying a lab. They arrive with a question such as "why does this link fail, and what would fix it?" and answer it by building a topology, then cutting fibers, failing devices and changing settings to watch the physics respond.

## Product Purpose
Lightpath is an interactive physical-layer simulator for DWDM links. It lets someone place devices, cable them, and see power, OSNR, margin, protection behaviour, transients and faults respond immediately, with explanations of why. Success is that the user understands the cause of a result (a dirty connector, an overloaded receiver, a blocked channel, a missing protection route), not just that they see a number.

## Positioning
An interactive, dependency-free physical-layer lab that runs from a single HTML page: build and break a topology and see the physics and its explanation update at once. It is a design and learning tool, complementary to (not a recreation of) SDN emulation platforms such as Mininet-Optical.

## Operating Context
The user works at a canvas of devices and cables, with an inspector for the selected device or cable and tabs for the results (power map, hop-by-hop table, clients, channels, reachability, OTDR, spectrum, constellation, planner, launch sweep, Raman, resilience, transients, and Learn). Scenarios are loaded from a dropdown and labs can be exported and imported as JSON. The page is published at https://yzguy.dev/lightpath/ through GitHub Pages.

## Capabilities and Constraints
- Models transponders and muxponders, amplifiers (including Raman), ROADMs and passive OADMs with numbered ports, muxes, patch panels, splitters and optical switches, hosts and reachability, single-fiber (BiDi) links, a 1510 nm supervisory channel and 1310 nm client ports, protection and wavelength converters, device and port failures, overloads, and a power meter and OTDR.
- The channel plan can be a table or can be derived from the cabling.
- Physics constants are representative values, not datasheet figures; the app should say so rather than imply precision. Physics and model code stay DOM-free and covered by tests, and anything loaded from storage or pasted import is sanitised.
- Both light and dark themes must keep working.
- Undecided or not yet verified: phone and touch use, and Safari, have not been tested.

## Brand Commitments
The product is named Lightpath. No logo, voice guide or other identity assets have been established.

## Evidence on Hand
- README.md (feature descriptions and a backlog of ideas).
- In-app Learn topics and a library of scenarios that demonstrate each feature.
- An automated test suite for the physics and the model.
- No testimonials, customer lists, benchmarks against real equipment, or usage data exist; future work must not invent them.

## Product Principles
1. Explain the cause, not only the number: every failure, warning or overload says what is wrong and what would fix it.
2. Let the user break things: cutting, failing and misconfiguring are first-class ways to learn.
3. Be honest about precision: representative constants are labelled as such, and the model's limits are documented.
4. Keep it self-contained: one page, no dependencies, readable offline.
5. Make state visible where it happens: overloads, blocked paths and dirty connectors are marked on the canvas, the tables and the alarms, not only in a result tab.
