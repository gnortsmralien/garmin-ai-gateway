/**
 * Unit Tests for WeatherTool
 *
 * Run these tests by calling: runWeatherToolTests()
 */

function runWeatherToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful weather fetch
  runner.test("WeatherTool - successful fetch returns current and forecast", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      current: {
        temperature_2m: 15.5,
        relative_humidity_2m: 65,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 12,
        wind_direction_10m: 180
      },
      daily: {
        time: ["2024-01-15", "2024-01-16", "2024-01-17"],
        temperature_2m_max: [18, 20, 19],
        temperature_2m_min: [12, 14, 13],
        precipitation_probability_max: [20, 40, 10],
        weather_code: [2, 61, 1]
      }
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertNotNull(result.data, "Should have data");
    assertContains(result.data, "NOW:", "Should contain current weather");
    assertContains(result.data, "15.5°C", "Should contain temperature");
    assertContains(result.data, "Partly cloudy", "Should decode weather code");
    assertContains(result.data, "Today:", "Should contain today's forecast");
    assertContains(result.data, "Tomorrow:", "Should contain tomorrow's forecast");
  });

  // Test 2: Weather code conversion
  runner.test("WeatherTool - converts weather codes correctly", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    assertEquals(tool.weatherCodeToText(0), "Clear");
    assertEquals(tool.weatherCodeToText(61), "Light rain");
    assertEquals(tool.weatherCodeToText(95), "Thunderstorm");
    assertEquals(tool.weatherCodeToText(999), "Code 999"); // Unknown code
  });

  // Test 3: HTTP error handling
  runner.test("WeatherTool - handles HTTP errors", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockResponse("open-meteo.com", 500, "Server Error");

    var result = tool.fetch(40.4168, -3.7038);

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "HTTP_500", "Should have HTTP_500 error");
  });

  // Test 4: Malformed JSON
  runner.test("WeatherTool - handles malformed JSON", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockResponse("open-meteo.com", 200, "invalid json");

    var result = tool.fetch(40.4168, -3.7038);

    assertFalse(result.success, "Should fail");
    assertContains(result.error, "EXCEPTION", "Should have exception error");
  });

  // Test 5: URL contains correct parameters
  runner.test("WeatherTool - builds URL with correct parameters", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      current: {},
      daily: { time: [] }
    });

    tool.fetch(52.52, 13.41);

    var requests = mockHttp.getRequests();
    assertEquals(requests.length, 1, "Should make one request");
    assertContains(requests[0].url, "latitude=52.52", "Should include latitude");
    assertContains(requests[0].url, "longitude=13.41", "Should include longitude");
    assertContains(requests[0].url, "forecast_days=3", "Should include forecast days");
    assertContains(requests[0].url, "timezone=auto", "Should include timezone");
  });

  // Test 6: Successful astronomy fetch
  runner.test("WeatherTool - fetchAstronomy returns sun times", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      daily: {
        time: ["2024-01-15", "2024-01-16"],
        sunrise: ["2024-01-15T07:30", "2024-01-16T07:31"],
        sunset: ["2024-01-15T18:45", "2024-01-16T18:46"],
        daylight_duration: [40500, 40560]
      }
    });

    var result = tool.fetchAstronomy(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Today:", "Should contain today");
    assertContains(result.data, "Sunrise 07:30", "Should contain sunrise time");
    assertContains(result.data, "Sunset 18:45", "Should contain sunset time");
    assertContains(result.data, "11.3hr daylight", "Should calculate daylight hours");
  });

  // Test 7: Astronomy with missing data
  runner.test("WeatherTool - fetchAstronomy handles missing data", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      daily: {
        time: ["2024-01-15"],
        sunrise: [null],
        sunset: [null],
        daylight_duration: [null]
      }
    });

    var result = tool.fetchAstronomy(90, 0); // North pole

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "N/A", "Should show N/A for missing data");
  });

  // Test 8: Custom forecast days configuration
  runner.test("WeatherTool - respects custom forecast days", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://api.open-meteo.com/v1/forecast", 5);
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      current: {},
      daily: { time: [] }
    });

    tool.fetch(40.4168, -3.7038);

    var requests = mockHttp.getRequests();
    assertContains(requests[0].url, "forecast_days=5", "Should use custom forecast days");
  });

  // Test 9: Empty daily data
  runner.test("WeatherTool - handles missing daily data", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      current: {
        temperature_2m: 15.5,
        relative_humidity_2m: 65,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 12,
        wind_direction_10m: 180
      }
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "NOW:", "Should have current weather");
    // Should not crash even without daily data
  });

  // Test 10: Limits forecast to 3 days
  runner.test("WeatherTool - limits forecast output to 3 days", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig();
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("open-meteo.com", {
      current: {
        temperature_2m: 15,
        relative_humidity_2m: 60,
        precipitation: 0,
        weather_code: 0,
        wind_speed_10m: 10,
        wind_direction_10m: 180
      },
      daily: {
        time: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
        temperature_2m_max: [18, 20, 19, 21, 22],
        temperature_2m_min: [12, 14, 13, 15, 16],
        precipitation_probability_max: [20, 40, 10, 30, 50],
        weather_code: [2, 61, 1, 3, 63]
      }
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    var lines = result.data.split("\n");
    // Should have: NOW + Today + Tomorrow + Day 3 = 4 lines max
    assertTrue(lines.length <= 4, "Should limit to 4 lines (current + 3 days)");
  });

  return runner.run();
}
