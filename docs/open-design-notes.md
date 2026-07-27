# Open Design notes

Racio uses the development-time principle from the Open Design project:
`DESIGN.md` is an authoritative brand and interface contract that agents and
engineers read before creating UI, and visual review is part of implementation
rather than a final decoration pass. Open Design itself is not a Racio runtime
dependency. The reference is https://github.com/nexu-io/open-design.

For Racio, this means each screen starts from a user task, information priority,
and the data state it must communicate. The design contract then governs
components, density, RTL, accessibility, loading, and review evidence.
