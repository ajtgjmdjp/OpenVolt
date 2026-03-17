find_package(GTest REQUIRED)

add_executable(openvolt_tests
    test_risk.cpp
    test_portfolio.cpp
    test_tax_lot.cpp
    test_tax_policy.cpp
    test_api.cpp
)

target_link_libraries(openvolt_tests
    PRIVATE openvolt_core GTest::gtest_main
)

include(GoogleTest)
gtest_discover_tests(openvolt_tests)
