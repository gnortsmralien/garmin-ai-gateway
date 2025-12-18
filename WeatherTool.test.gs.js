/**
 * Unit Tests for WeatherTool
 * Tests the wttr.in API integration
 *
 * Run these tests by calling: runWeatherToolTests()
 */

function runWeatherToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful weather fetch
  runner.test("WeatherTool - successful fetch returns current and forecast", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [{
        temp_C: "15",
        weatherDesc: [{ value: "Partly cloudy" }],
        windspeedKmph: "12",
        humidity: "65"
      }],
      weather: [{
        date: "2024-01-15",
        maxtempC: "18",
        mintempC: "12",
        hourly: [
          { chanceofrain: "10", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "15", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "20", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "25", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "20", weatherDesc: [{ value: "Partly cloudy" }] }
        ],
        astronomy: [{ sunrise: "07:30 AM", sunset: "06:45 PM" }]
      }, {
        date: "2024-01-16",
        maxtempC: "20",
        mintempC: "14",
        hourly: [
          { chanceofrain: "30", weatherDesc: [{ value: "Light rain" }] },
          { chanceofrain: "40", weatherDesc: [{ value: "Light rain" }] },
          { chanceofrain: "35", weatherDesc: [{ value: "Light rain" }] },
          { chanceofrain: "30", weatherDesc: [{ value: "Cloudy" }] },
          { chanceofrain: "25", weatherDesc: [{ value: "Light rain" }] }
        ],
        astronomy: [{ sunrise: "07:31 AM", sunset: "06:46 PM" }]
      }, {
        date: "2024-01-17",
        maxtempC: "19",
        mintempC: "13",
        hourly: [
          { chanceofrain: "10", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "5", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "5", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "10", weatherDesc: [{ value: "Sunny" }] },
          { chanceofrain: "10", weatherDesc: [{ value: "Clear" }] }
        ],
        astronomy: [{ sunrise: "07:32 AM", sunset: "06:47 PM" }]
      }]
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertNotNull(result.data, "Should have data");
    assertContains(result.data, "NOW:", "Should contain current weather");
    assertContains(result.data, "15°C", "Should contain temperature");
    assertContains(result.data, "Partly cloudy", "Should contain weather description");
    assertContains(result.data, "Today:", "Should contain today's forecast");
    assertContains(result.data, "Tomorrow:", "Should contain tomorrow's forecast");
  });

  // Test 2: Weather description extraction
  runner.test("WeatherTool - extracts weather description correctly", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [{
        temp_C: "22",
        weatherDesc: [{ value: "Thunderstorm" }],
        windspeedKmph: "25",
        humidity: "80"
      }],
      weather: [{
        date: "2024-01-15",
        maxtempC: "25",
        mintempC: "18",
        hourly: [{ chanceofrain: "80", weatherDesc: [{ value: "Heavy rain" }] }]
      }]
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Thunderstorm", "Should show current thunderstorm");
    assertContains(result.data, "Heavy rain", "Should show forecast rain");
  });

  // Test 3: HTTP error handling
  runner.test("WeatherTool - handles HTTP errors", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockResponse("wttr.in", 500, "Server Error");

    var result = tool.fetch(40.4168, -3.7038);

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "HTTP_500", "Should have HTTP_500 error");
  });

  // Test 4: Malformed JSON
  runner.test("WeatherTool - handles malformed JSON", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockResponse("wttr.in", 200, "invalid json");

    var result = tool.fetch(40.4168, -3.7038);

    assertFalse(result.success, "Should fail");
    assertContains(result.error, "EXCEPTION", "Should have exception error");
  });

  // Test 5: URL contains correct parameters
  runner.test("WeatherTool - builds URL with correct parameters", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [],
      weather: []
    });

    tool.fetch(52.52, 13.41);

    var requests = mockHttp.getRequests();
    assertEquals(requests.length, 1, "Should make one request");
    assertContains(requests[0].url, "52.52,13.41", "Should include coordinates");
    assertContains(requests[0].url, "format=j1", "Should request JSON format");
  });

  // Test 6: Astronomy data in combined fetch
  runner.test("WeatherTool - includes astronomy when requested", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [{
        temp_C: "15",
        weatherDesc: [{ value: "Clear" }],
        windspeedKmph: "5",
        humidity: "50"
      }],
      weather: [{
        date: "2024-01-15",
        maxtempC: "18",
        mintempC: "12",
        hourly: [{ chanceofrain: "0", weatherDesc: [{ value: "Sunny" }] }],
        astronomy: [{ sunrise: "07:30 AM", sunset: "06:45 PM" }]
      }, {
        date: "2024-01-16",
        maxtempC: "20",
        mintempC: "14",
        hourly: [{ chanceofrain: "10", weatherDesc: [{ value: "Partly cloudy" }] }],
        astronomy: [{ sunrise: "07:31 AM", sunset: "06:46 PM" }]
      }]
    });

    var result = tool.fetch(40.4168, -3.7038, null, true);  // includeAstronomy = true

    assertTrue(result.success, "Should succeed");
    assertNotNull(result.astronomy, "Should have astronomy data");
    assertContains(result.astronomy, "Sunrise", "Should contain sunrise");
    assertContains(result.astronomy, "Sunset", "Should contain sunset");
    assertContains(result.astronomy, "Today:", "Should have today's astronomy");
    assertContains(result.astronomy, "Tomorrow:", "Should have tomorrow's astronomy");
  });

  // Test 7: Astronomy data not included by default
  runner.test("WeatherTool - excludes astronomy by default", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [{
        temp_C: "20",
        weatherDesc: [{ value: "Sunny" }],
        windspeedKmph: "10",
        humidity: "55"
      }],
      weather: [{
        date: "2024-01-15",
        maxtempC: "22",
        mintempC: "15",
        hourly: [{ chanceofrain: "0", weatherDesc: [{ value: "Sunny" }] }],
        astronomy: [{ sunrise: "06:00 AM", sunset: "08:00 PM" }]
      }]
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    assertEquals(result.astronomy, null, "Should not have astronomy by default");
  });

  // Test 8: Custom base URL
  runner.test("WeatherTool - respects custom base URL", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://custom-weather.example.com");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("custom-weather.example.com", {
      current_condition: [],
      weather: []
    });

    tool.fetch(40.4168, -3.7038);

    var requests = mockHttp.getRequests();
    assertContains(requests[0].url, "custom-weather.example.com", "Should use custom URL");
  });

  // Test 9: Empty weather data
  runner.test("WeatherTool - handles missing current condition", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      weather: [{
        date: "2024-01-15",
        maxtempC: "18",
        mintempC: "12",
        hourly: [{ chanceofrain: "20", weatherDesc: [{ value: "Cloudy" }] }]
      }]
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed even without current conditions");
    assertContains(result.data, "Today:", "Should still have forecast");
  });

  // Test 10: Limits forecast to 3 days
  runner.test("WeatherTool - limits forecast output to 3 days", function() {
    var mockHttp = new MockHttpClient();
    var config = new WeatherConfig("https://wttr.in");
    var tool = new WeatherTool(mockHttp, config);

    mockHttp.mockJsonResponse("wttr.in", {
      current_condition: [{
        temp_C: "15",
        weatherDesc: [{ value: "Clear" }],
        windspeedKmph: "10",
        humidity: "60"
      }],
      weather: [
        { date: "2024-01-15", maxtempC: "18", mintempC: "12", hourly: [{ chanceofrain: "10", weatherDesc: [{ value: "Sunny" }] }] },
        { date: "2024-01-16", maxtempC: "20", mintempC: "14", hourly: [{ chanceofrain: "20", weatherDesc: [{ value: "Cloudy" }] }] },
        { date: "2024-01-17", maxtempC: "19", mintempC: "13", hourly: [{ chanceofrain: "15", weatherDesc: [{ value: "Sunny" }] }] },
        { date: "2024-01-18", maxtempC: "21", mintempC: "15", hourly: [{ chanceofrain: "30", weatherDesc: [{ value: "Rain" }] }] },
        { date: "2024-01-19", maxtempC: "22", mintempC: "16", hourly: [{ chanceofrain: "50", weatherDesc: [{ value: "Storm" }] }] }
      ]
    });

    var result = tool.fetch(40.4168, -3.7038);

    assertTrue(result.success, "Should succeed");
    var lines = result.data.split("\n");
    // Should have: NOW + Today + Tomorrow + Day 3 = 4 lines max
    assertTrue(lines.length <= 4, "Should limit to 4 lines (current + 3 days)");
    // Should NOT contain 4th or 5th day
    assertFalse(result.data.indexOf("2024-01-18") !== -1, "Should not include day 4");
    assertFalse(result.data.indexOf("2024-01-19") !== -1, "Should not include day 5");
  });

  return runner.run();
}
